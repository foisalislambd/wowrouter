package gateway

import "testing"

func TestFillFirstUsesTheFirstLiveAccount(t *testing.T) {
	e := New(nil)
	e.Breakers.CoolKey("openai", "a", 0)
	// Force a cooldown even when Retry-After is empty.
	e.Breakers.CoolKey("openai", "a", 1e9)
	spec := map[string]any{
		"account_strategy": "fill-first",
		"accounts": []any{
			map[string]any{"id": "a", "api_key": "first"},
			map[string]any{"id": "b", "api_key": "second"},
		},
	}
	id, secret := e.pickKey("openai", spec, nil)
	if id != "b" || secret != "second" {
		t.Fatalf("got %s %s", id, secret)
	}
}

type refreshCat struct{ *ledger }

func (refreshCat) EnsureFreshToken(string) (string, bool) { return "fresh", true }

func TestPickKeyUsesARefreshedToken(t *testing.T) {
	e := New(refreshCat{ledger: &ledger{}})
	_, secret := e.pickKey("openai", map[string]any{"auth": map[string]any{"api_key": "stale"}}, nil)
	if secret != "fresh" {
		t.Fatalf("secret %q", secret)
	}
}

func TestAliasResolvesToTheModel(t *testing.T) {
	cat := &ledger{mem: mem{docs: map[string]Named{
		"models/openai/gpt-4o-mini": {Name: "openai/gpt-4o-mini", Spec: map[string]any{
			"enabled": true,
			"aliases": map[string]any{"gpt-4o-mini": true},
			"target":  map[string]any{"type": "deployment", "deployment": "d"},
		}},
	}}}
	e := New(cat)
	spec, ok := e.resolveModel("gpt-4o-mini")
	if !ok || asString(asMap(spec["target"])["deployment"]) != "d" {
		t.Fatalf("spec %#v ok %v", spec, ok)
	}
}
