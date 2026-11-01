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
