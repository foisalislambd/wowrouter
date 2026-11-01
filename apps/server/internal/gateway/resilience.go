package gateway

import (
	"net/http"
	"strconv"
	"time"
)

type keyState struct {
	until   time.Time
	strikes int
	last    time.Duration
}

func (b *Breakers) initLocked() {
	if b.state == nil {
		b.state = map[string]*breaker{}
	}
	if b.keys == nil {
		b.keys = map[string]*keyState{}
	}
	if b.models == nil {
		b.models = map[string]time.Time{}
	}
	if b.cursors == nil {
		b.cursors = map[string]int{}
	}
	if b.lastGood == nil {
		b.lastGood = map[string]string{}
	}
	if b.quota == nil {
		b.quota = map[string]float64{}
	}
	if b.quotaSeen == nil {
		b.quotaSeen = map[string]bool{}
	}
}

func keyName(provider, id string) string { return provider + "\x00" + id }

// CoolKey puts a credential on cooldown. retryAfter wins when the upstream
// sent Retry-After. Otherwise the wait doubles on each strike, from 2s.
func (b *Breakers) CoolKey(provider, keyID string, retryAfter time.Duration) {
	if b == nil || keyID == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initLocked()
	k := b.keys[keyName(provider, keyID)]
	if k == nil {
		k = &keyState{}
		b.keys[keyName(provider, keyID)] = k
	}
	k.strikes++
	d := retryAfter
	if d <= 0 {
		shift := k.strikes
		if shift > 8 {
			shift = 8
		}
		d = time.Second << shift
	}
	if d > 15*time.Minute {
		d = 15 * time.Minute
	}
	k.last = d
	k.until = time.Now().Add(d)
}

// KeyCooling reports whether the credential should be skipped.
func (b *Breakers) KeyCooling(provider, keyID string) bool {
	if b == nil || keyID == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	k := b.keys[keyName(provider, keyID)]
	return k != nil && time.Now().Before(k.until)
}

// CoolFor is the last cooldown that was applied to this key.
func (b *Breakers) CoolFor(provider, keyID string) time.Duration {
	if b == nil {
		return 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	k := b.keys[keyName(provider, keyID)]
	if k == nil {
		return 0
	}
	return k.last
}

// NextKey round-robins through ids and skips keys that are cooling.
// It returns false when every key is cooling.
func (b *Breakers) NextKey(provider string, ids []string) (string, bool) {
	if b == nil || len(ids) == 0 {
		return "", false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initLocked()
	now := time.Now()
	start := b.cursors[provider] % len(ids)
	for i := 0; i < len(ids); i++ {
		id := ids[(start+i)%len(ids)]
		k := b.keys[keyName(provider, id)]
		if k != nil && now.Before(k.until) {
			continue
		}
		b.cursors[provider] = (start + i + 1) % len(ids)
		return id, true
	}
	return "", false
}

// LockModel stops sending one model for d.
func (b *Breakers) LockModel(provider, model string, d time.Duration) {
	if b == nil || model == "" || d <= 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initLocked()
	b.models[provider+"\x00"+model] = time.Now().Add(d)
}

// ModelAllowed is false while a lockout is in the future.
func (b *Breakers) ModelAllowed(provider, model string) bool {
	if b == nil || model == "" {
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	until, ok := b.models[provider+"\x00"+model]
	if !ok {
		return true
	}
	return !time.Now().Before(until)
}

// TakeCursor is a per-name counter for round-robin combos.
func (b *Breakers) TakeCursor(name string) int {
	if b == nil {
		return 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initLocked()
	n := b.cursors["combo:"+name]
	b.cursors["combo:"+name] = n + 1
	return n
}

// Remember notes the deployment that worked for a session.
func (b *Breakers) Remember(session, id string) {
	if b == nil || session == "" || id == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initLocked()
	b.lastGood[session] = id
}

// Last is the deployment remembered for a session.
func (b *Breakers) Last(session string) string {
	if b == nil || session == "" {
		return ""
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.lastGood[session]
}

// SetQuota stores a remaining-quota hint from an upstream header.
func (b *Breakers) SetQuota(provider string, remaining float64) {
	if b == nil || provider == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.initLocked()
	b.quota[provider] = remaining
	b.quotaSeen[provider] = true
}

// Quota reports the last remaining-quota hint. The bool is false until a
// header or caller has stored one, so zero remaining is not "unknown".
func (b *Breakers) Quota(provider string) (float64, bool) {
	if b == nil || provider == "" {
		return 0, false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.quotaSeen == nil || !b.quotaSeen[provider] {
		return 0, false
	}
	return b.quota[provider], true
}

// SnapshotAll is the in-memory breaker, cooldown, and quota view.
func (b *Breakers) SnapshotAll() []map[string]any {
	if b == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	var items []map[string]any
	for name, br := range b.state {
		state := "closed"
		if !br.openTill.IsZero() && now.Before(br.openTill) {
			state = "open"
		}
		items = append(items, map[string]any{
			"name": name, "kind": "provider", "state": state,
			"failures": br.failures, "inflight": br.inflight, "latency_ms": br.ewma,
			"quota": b.quota[name],
		})
	}
	for name, k := range b.keys {
		if !now.Before(k.until) {
			continue
		}
		items = append(items, map[string]any{
			"name": name, "kind": "key", "state": "cooldown",
			"retry_after_ms": k.until.Sub(now).Milliseconds(), "strikes": k.strikes,
		})
	}
	for name, until := range b.models {
		if !now.Before(until) {
			continue
		}
		items = append(items, map[string]any{
			"name": name, "kind": "model", "state": "locked",
			"retry_after_ms": until.Sub(now).Milliseconds(),
		})
	}
	return items
}

func retryAfterHeader(h http.Header) time.Duration {
	v := h.Get("Retry-After")
	if v == "" {
		return 0
	}
	if n, err := strconv.Atoi(v); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

func headerQuota(h http.Header) (float64, bool) {
	for _, name := range []string{"X-RateLimit-Remaining", "X-Ratelimit-Remaining-Requests"} {
		v := h.Get(name)
		if v == "" {
			continue
		}
		n, err := strconv.ParseFloat(v, 64)
		if err == nil {
			return n, true
		}
	}
	return 0, false
}
