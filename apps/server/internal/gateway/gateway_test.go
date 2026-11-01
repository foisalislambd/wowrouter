package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type mem struct {
	docs map[string]Named
}

func (m mem) Resource(collection, name string) (map[string]any, map[string]any, bool) {
	doc, ok := m.docs[collection+"/"+name]
	if !ok {
		return nil, nil, false
	}
	return doc.Spec, doc.Private, true
}

func (m mem) Resources(collection string) []Named {
	var out []Named
	for key, doc := range m.docs {
		if strings.HasPrefix(key, collection+"/") {
			out = append(out, doc)
		}
	}
	return out
}

func TestFallbackThenLeastCost(t *testing.T) {
	cat := mem{docs: map[string]Named{
		"deployments/expensive": {Name: "expensive", Spec: map[string]any{"provider": "openai", "model": "big", "price": map[string]any{"input": "10", "output": "30"}}},
		"deployments/cheap":     {Name: "cheap", Spec: map[string]any{"provider": "openai", "model": "small", "price": map[string]any{"input": "0.1", "output": "0.2"}}},
	}}
	tree := map[string]any{"type": "least_cost", "children": []any{
		map[string]any{"type": "deployment", "deployment": "expensive"},
		map[string]any{"type": "deployment", "deployment": "cheap"},
	}}
	leaves, blocked := Plan(tree, cat, Facts{})
	if blocked || len(leaves) != 1 || leaves[0].Deployment != "cheap" {
		t.Fatalf("leaves=%+v blocked=%v", leaves, blocked)
	}
	fallback := map[string]any{"type": "fallback", "children": []any{
		map[string]any{"type": "deployment", "deployment": "expensive"},
		map[string]any{"type": "deployment", "deployment": "cheap"},
	}}
	leaves, _ = Plan(fallback, cat, Facts{})
	if len(leaves) != 2 || leaves[0].Deployment != "expensive" || leaves[1].Deployment != "cheap" {
		t.Fatalf("fallback leaves=%+v", leaves)
	}
}

func TestClassifierAndConditional(t *testing.T) {
	cat := mem{docs: map[string]Named{
		"deployments/support": {Name: "support", Spec: map[string]any{"provider": "openai", "model": "s"}},
		"deployments/general": {Name: "general", Spec: map[string]any{"provider": "openai", "model": "g"}},
	}}
	tree := map[string]any{"type": "classifier", "classes": []any{
		map[string]any{"name": "support", "keywords": []any{"refund"}, "target": map[string]any{"type": "deployment", "deployment": "support"}},
	}, "default": map[string]any{"type": "deployment", "deployment": "general"}}
	leaves, _ := Plan(tree, cat, Facts{Text: "I want a refund"})
	if len(leaves) != 1 || leaves[0].Deployment != "support" {
		t.Fatalf("classifier %+v", leaves)
	}
	cond := map[string]any{"type": "conditional", "rules": []any{
		map[string]any{"when": map[string]any{"field": "identity.team", "eq": "platform"}, "target": map[string]any{"type": "deployment", "deployment": "support"}},
	}, "default": map[string]any{"type": "deployment", "deployment": "general"}}
	leaves, _ = Plan(cond, cat, Facts{Team: "platform"})
	if leaves[0].Deployment != "support" {
		t.Fatalf("conditional %+v", leaves)
	}
}

func TestGuardrailsRedactAndBlock(t *testing.T) {
	rules := []Named{
		{Name: "mail", Spec: map[string]any{"type": "pii", "action": "redact", "enabled": true, "pii": map[string]any{"entities": []any{"email"}}}},
		{Name: "secret", Spec: map[string]any{"type": "keywords", "action": "block", "enabled": true, "keywords": map[string]any{"words": []any{"confidential"}}}},
	}
	got := Apply(rules, "mail me at ada@example.com", "input")
	if got.Blocked || !strings.Contains(got.Text, "[email]") || strings.Contains(got.Text, "ada@example.com") {
		t.Fatalf("redact %+v", got)
	}
	blocked := Apply(rules, "this is confidential", "input")
	if !blocked.Blocked {
		t.Fatal("expected block")
	}
}

func TestDialectRoundTrip(t *testing.T) {
	body, err := ToOpenAI("anthropic", "", []byte(`{"model":"chat","system":"be brief","messages":[{"role":"user","content":"Hello"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if asString(body["model"]) != "chat" || len(asSlice(body["messages"])) != 2 {
		t.Fatalf("body %#v", body)
	}
	openai := []byte(`{"choices":[{"message":{"role":"assistant","content":"Hi"}}]}`)
	out := FromOpenAI("gemini", "chat", openai)
	if !strings.Contains(string(out), `"text":"Hi"`) {
		t.Fatalf("gemini %s", out)
	}
}

type ledger struct {
	mem
	spend float64
	cache map[string]string
	logs  int
}

func (l *ledger) AllowRate(string, int, time.Duration) bool { return true }
func (l *ledger) SpendOf(string) float64                    { return l.spend }
func (l *ledger) AddSpend(_ string, usd float64, _ int) float64 {
	l.spend += usd
	return l.spend
}
func (l *ledger) CacheGet(key string) (string, bool) {
	v, ok := l.cache[key]
	return v, ok
}
func (l *ledger) CachePut(key, _, _, response, _ string, _ bool) { l.cache[key] = response }
func (l *ledger) CacheSemantic(string, string, float64) (string, float64, bool) {
	return "", 0, false
}
func (l *ledger) AddLog(map[string]any)   { l.logs++ }
func (l *ledger) PutAlert(map[string]any) {}

func TestEngineCacheBudgetAndUpstream(t *testing.T) {
	var hits int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}`))
	}))
	defer upstream.Close()
	cat := &ledger{mem: mem{docs: map[string]Named{
		"models/chat":      {Name: "chat", Spec: map[string]any{"enabled": true, "target": map[string]any{"type": "deployment", "deployment": "mini"}}},
		"deployments/mini": {Name: "mini", Spec: map[string]any{"provider": "openai", "model": "gpt-4o-mini", "price": map[string]any{"input": "1", "output": "2"}}},
		"providers/openai": {Name: "openai", Spec: map[string]any{"type": "openai_compatible", "base_url": upstream.URL}, Private: map[string]any{"type": "openai_compatible", "base_url": upstream.URL, "auth": map[string]any{"api_key": "sk-test"}}},
		"keys/app":         {Name: "app", Spec: map[string]any{"policies": map[string]any{"budgets": map[string]any{"m": map[string]any{"unit": "usd", "amount": "1", "period": "monthly", "mode": "hard"}}}}},
		"settings/cache":   {Name: "cache", Spec: map[string]any{"enabled": true}},
	}}, cache: map[string]string{}}
	eng := New(cat)
	body := map[string]any{"model": "chat", "messages": []any{map[string]any{"role": "user", "content": "Hello"}}}
	first := eng.Handle(Call{Model: "chat", Body: body, KeyName: "app", Dialect: "openai"})
	if first.Status != 200 || hits != 1 || cat.logs != 1 {
		t.Fatalf("first status=%d hits=%d logs=%d err=%s body=%s", first.Status, hits, cat.logs, first.Error, first.Body)
	}
	second := eng.Handle(Call{Model: "chat", Body: body, KeyName: "app"})
	if !second.Cached || hits != 1 {
		t.Fatalf("expected cache hit, cached=%v hits=%d", second.Cached, hits)
	}
	cat.spend = 2
	third := eng.Handle(Call{Model: "chat", Body: map[string]any{"model": "chat", "messages": []any{map[string]any{"role": "user", "content": "another"}}}, KeyName: "app"})
	if third.Status != http.StatusTooManyRequests {
		t.Fatalf("budget status=%d err=%s", third.Status, third.Error)
	}
}

func TestWeightedIsStableForRoll(t *testing.T) {
	cat := mem{docs: map[string]Named{
		"deployments/a": {Name: "a", Spec: map[string]any{"provider": "openai", "model": "a"}},
		"deployments/b": {Name: "b", Spec: map[string]any{"provider": "openai", "model": "b"}},
	}}
	tree := map[string]any{"type": "weighted", "children": []any{
		map[string]any{"type": "deployment", "deployment": "a", "weight": 1},
		map[string]any{"type": "deployment", "deployment": "b", "weight": 9},
	}}
	leaves, _ := Plan(tree, cat, Facts{Rand: 0.95})
	if leaves[0].Deployment != "b" {
		t.Fatalf("got %s", leaves[0].Deployment)
	}
}

func TestDisabledDeploymentAndBlock(t *testing.T) {
	cat := mem{docs: map[string]Named{
		"deployments/off":  {Name: "off", Spec: map[string]any{"provider": "openai", "model": "m", "enabled": false}},
		"deployments/on":   {Name: "on", Spec: map[string]any{"provider": "openai", "model": "m", "enabled": true}},
		"providers/openai": {Name: "openai", Spec: map[string]any{"enabled": false}},
	}}
	leaves, blocked := Plan(map[string]any{"type": "deployment", "deployment": "off"}, cat, Facts{})
	if blocked || len(leaves) != 0 {
		t.Fatalf("disabled leaf leaves=%+v blocked=%v", leaves, blocked)
	}
	leaves, _ = Plan(map[string]any{"type": "deployment", "deployment": "on"}, cat, Facts{})
	if len(leaves) != 0 {
		t.Fatalf("disabled provider still planned %+v", leaves)
	}
	onlyBlock, blocked := Plan(map[string]any{"type": "fallback", "children": []any{
		map[string]any{"type": "block"},
	}}, cat, Facts{})
	if !blocked || len(onlyBlock) != 0 {
		t.Fatalf("block fallback leaves=%+v blocked=%v", onlyBlock, blocked)
	}
}

func TestConditionalLengthUsesTheField(t *testing.T) {
	when := map[string]any{"field": "request.text_length", "gt": 10}
	if matchWhen(when, Facts{Text: "short", InputTokens: 100}) {
		t.Fatal("token estimate matched a text-length rule")
	}
	if !matchWhen(when, Facts{Text: "this is long enough", InputTokens: 0}) {
		t.Fatal("long text did not match")
	}
}

func TestSafeURLAndAzurePath(t *testing.T) {
	if err := SafeHTTPURL("http://example.com/v1"); err == nil {
		t.Fatal("public http URL accepted")
	}
	if err := SafeHTTPURL("http://127.0.0.1:9/v1"); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"model": "chat", "stream": true, "messages": []any{
		map[string]any{"role": "system", "content": "a"},
		map[string]any{"role": "system", "content": "b"},
		map[string]any{"role": "user", "content": "hi"},
	}}
	path, payload, _ := ToUpstream("azure_openai", body, "my deploy")
	if !strings.Contains(path, "/openai/deployments/my%20deploy/chat/completions") {
		t.Fatalf("path %s", path)
	}
	if strings.Contains(string(payload), `"stream"`) {
		t.Fatalf("stream forwarded: %s", payload)
	}
	_, anth, _ := ToUpstream("anthropic", body, "claude")
	if !strings.Contains(string(anth), `"system":"a\nb"`) && !strings.Contains(string(anth), `"system":"a\\nb"`) {
		t.Fatalf("system %s", anth)
	}
}

func TestHedgeDoesNotWaitForTheSlowLeaf(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(400 * time.Millisecond)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"slow"}}]}`))
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"fast"}}]}`))
	}))
	defer fast.Close()
	provider := func(name, base string) Named {
		return Named{Name: name, Spec: map[string]any{"type": "openai_compatible", "base_url": base, "enabled": true}, Private: map[string]any{"type": "openai_compatible", "base_url": base, "auth": map[string]any{"api_key": "k"}}}
	}
	cat := &ledger{mem: mem{docs: map[string]Named{
		"models/chat": {Name: "chat", Spec: map[string]any{
			"enabled":  true,
			"policies": map[string]any{"resilience": map[string]any{"hedging": map[string]any{"enabled": true, "delay": "30ms"}}},
			"target": map[string]any{"type": "fallback", "children": []any{
				map[string]any{"type": "deployment", "deployment": "slow"},
				map[string]any{"type": "deployment", "deployment": "fast"},
			}},
		}},
		"deployments/slow": {Name: "slow", Spec: map[string]any{"provider": "slowp", "model": "m", "enabled": true}},
		"deployments/fast": {Name: "fast", Spec: map[string]any{"provider": "fastp", "model": "m", "enabled": true}},
		"providers/slowp":  provider("slowp", slow.URL),
		"providers/fastp":  provider("fastp", fast.URL),
	}}, cache: map[string]string{}}
	eng := New(cat)
	started := time.Now()
	out := eng.Handle(Call{Model: "chat", Body: map[string]any{"model": "chat", "messages": []any{map[string]any{"role": "user", "content": "hi"}}}})
	elapsed := time.Since(started)
	if out.Status != 200 || !strings.Contains(string(out.Body), "fast") {
		t.Fatalf("status %d body %s err %s", out.Status, out.Body, out.Error)
	}
	if elapsed > 300*time.Millisecond {
		t.Fatalf("hedge waited %s", elapsed)
	}
}

func TestClientErrorsDoNotOpenTheBreaker(t *testing.T) {
	b := NewBreakers()
	for i := 0; i < 8; i++ {
		b.LatencyOnly("dep", 3)
	}
	state, failures, _ := b.Snapshot("dep")
	if state != "closed" || failures != 0 {
		t.Fatalf("state %s failures %d", state, failures)
	}
	for i := 0; i < 5; i++ {
		b.Note("dep", 3, false)
	}
	state, _, _ = b.Snapshot("dep")
	if state != "open" {
		t.Fatalf("state %s", state)
	}
}
