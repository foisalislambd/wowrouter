package gateway

import (
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestBreakerOpensAndCloses(t *testing.T) {
	b := NewBreakers()
	for i := 0; i < 4; i++ {
		b.Note("openai", 12, false)
		if !b.Allow("openai") {
			t.Fatal("opened early")
		}
	}
	b.Note("openai", 12, false)
	if b.Allow("openai") {
		t.Fatal("expected open")
	}
	state, failures, _ := b.Snapshot("openai")
	if state != "open" || failures < 5 {
		t.Fatalf("%s %d", state, failures)
	}
	b.Note("openai", 8, true)
	if !b.Allow("openai") {
		t.Fatal("expected closed")
	}
}

func TestKeyRotationSkipsCooldown(t *testing.T) {
	spec := map[string]any{"accounts": []any{
		map[string]any{"id": "a", "api_key": "k1"},
		map[string]any{"id": "b", "api_key": "k2"},
		map[string]any{"id": "off", "api_key": "k3", "enabled": false},
	}}
	slots := collectKeys(spec, nil)
	if len(slots) != 2 || slots[0].ID != "a" || slots[1].Secret != "k2" {
		t.Fatalf("%+v", slots)
	}
	b := NewBreakers()
	ids := []string{slots[0].ID, slots[1].ID}
	first, ok := b.NextKey("openai", ids)
	second, _ := b.NextKey("openai", ids)
	third, _ := b.NextKey("openai", ids)
	if !ok || first != "a" || second != "b" || third != "a" {
		t.Fatalf("%s %s %s", first, second, third)
	}
	b.CoolKey("openai", "a", time.Minute)
	if !b.KeyCooling("openai", "a") {
		t.Fatal("not cooling")
	}
	got, ok := b.NextKey("openai", ids)
	if !ok || got != "b" {
		t.Fatalf("got %s", got)
	}
	b.CoolKey("openai", "b", time.Minute)
	if _, ok := b.NextKey("openai", ids); ok {
		t.Fatal("both keys cooling")
	}
}

func TestCooldownBackoffAndRetryAfter(t *testing.T) {
	b := NewBreakers()
	b.CoolKey("p", "k", 0)
	d1 := b.CoolFor("p", "k")
	b.CoolKey("p", "k", 0)
	d2 := b.CoolFor("p", "k")
	if d1 < time.Second || d2 <= d1 {
		t.Fatalf("backoff %s then %s", d1, d2)
	}
	b.CoolKey("p", "k", 9*time.Second)
	if b.CoolFor("p", "k") != 9*time.Second {
		t.Fatal(b.CoolFor("p", "k"))
	}
}

func TestModelLockout(t *testing.T) {
	b := NewBreakers()
	if !b.ModelAllowed("openai", "gone") {
		t.Fatal("locked before")
	}
	b.LockModel("openai", "gone", time.Minute)
	if b.ModelAllowed("openai", "gone") {
		t.Fatal("expected lock")
	}
	if !b.ModelAllowed("openai", "other") {
		t.Fatal("other model")
	}
}

func TestZeroQuotaStaysKnown(t *testing.T) {
	b := NewBreakers()
	if _, ok := b.Quota("p"); ok {
		t.Fatal("unknown looked known")
	}
	b.SetQuota("p", 0)
	q, ok := b.Quota("p")
	if !ok || q != 0 {
		t.Fatalf("%v %v", q, ok)
	}
}

func TestRetryAfterHTTPDate(t *testing.T) {
	h := http.Header{}
	h.Set("Retry-After", time.Now().Add(30*time.Second).UTC().Format(http.TimeFormat))
	d := retryAfterHeader(h)
	if d < 20*time.Second || d > 40*time.Second {
		t.Fatal(d)
	}
}

func TestDistinctKeyIDsKeepBothSecrets(t *testing.T) {
	spec := map[string]any{"auth": map[string]any{"api_key": "from-spec"}}
	priv := map[string]any{"auth": map[string]any{"api_key": "from-priv"}}
	slots := collectKeys(spec, priv)
	if len(slots) != 2 || slots[0].Secret == slots[1].Secret || slots[0].ID == slots[1].ID {
		t.Fatalf("%+v", slots)
	}
	e := New(nil)
	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		_, secret := e.pickKey("openai", spec, priv)
		seen[secret] = true
	}
	if !seen["from-spec"] || !seen["from-priv"] {
		t.Fatal(seen)
	}
}

func TestBreakerMethodsAreSafeConcurrently(t *testing.T) {
	b := NewBreakers()
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 50; n++ {
				b.NextKey("p", []string{"a", "b"})
				b.CoolKey("p", "a", time.Millisecond)
				b.LockModel("p", "m", time.Millisecond)
				b.SetQuota("p", 1)
				_, _ = b.Quota("p")
				_ = b.ModelAllowed("p", "m")
			}
		}()
	}
	wg.Wait()
}

func TestPickKeyUsesEveryAccount(t *testing.T) {
	e := New(nil)
	spec := map[string]any{"accounts": []any{
		map[string]any{"id": "a", "api_key": "k1"},
		map[string]any{"id": "b", "api_key": "k2"},
	}}
	id1, s1 := e.pickKey("openai", spec, nil)
	id2, s2 := e.pickKey("openai", spec, nil)
	if id1 != "a" || s1 != "k1" || id2 != "b" || s2 != "k2" {
		t.Fatalf("%s %s %s %s", id1, s1, id2, s2)
	}
}
