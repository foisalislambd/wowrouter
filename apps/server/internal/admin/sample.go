package admin

import "fmt"

// SeedSample inserts a local catalog so the console lists have rows.
// It does not insert provider secrets or request history. A second call leaves existing rows in place.
func SeedSample(s *Store) error {
	if _, err := s.Get("providers", "openai"); err == nil {
		return nil
	}
	specs := []struct {
		col, name string
		spec      map[string]any
	}{
		{"providers", "openai", map[string]any{"type": "openai", "enabled": true}},
		{"providers", "anthropic", map[string]any{"type": "anthropic", "enabled": true}},
		{"deployments", "openai-gpt-4o-mini", map[string]any{"provider": "openai", "model": "gpt-4o-mini", "enabled": true, "price": map[string]any{"input": "0.15", "output": "0.60"}}},
		{"deployments", "anthropic-haiku", map[string]any{"provider": "anthropic", "model": "claude-haiku-4-5", "enabled": true, "price": map[string]any{"input": "0.80", "output": "4"}}},
		{"routes", "default", map[string]any{"enabled": true, "tree": map[string]any{
			"type": "fallback",
			"children": []any{
				map[string]any{"type": "deployment", "deployment": "openai-gpt-4o-mini", "weight": 2},
				map[string]any{"type": "deployment", "deployment": "anthropic-haiku", "weight": 1},
			},
		}}},
		{"models", "chat", map[string]any{"route": "default", "enabled": true, "display_name": "Chat", "tier": "standard"}},
		{"models", "fast", map[string]any{"target": map[string]any{"type": "least_cost", "children": []any{
			map[string]any{"type": "deployment", "deployment": "openai-gpt-4o-mini"},
			map[string]any{"type": "deployment", "deployment": "anthropic-haiku"},
		}}, "enabled": true, "display_name": "Fast"}},
		{"guardrails", "secrets", map[string]any{"type": "secrets", "enabled": true, "action": "redact", "order": 1}},
		{"guardrails", "pii", map[string]any{"type": "pii", "enabled": true, "action": "redact", "order": 2, "pii": map[string]any{"entities": []any{"email", "phone", "us_ssn"}}}},
		{"keys", "playground", map[string]any{"project": "default", "enabled": true, "description": "Sample key", "policies": map[string]any{
			"budgets": map[string]any{"monthly": map[string]any{"unit": "usd", "amount": "50", "period": "monthly", "mode": "hard", "alert_at": []any{0.8}}},
			"limits":  map[string]any{"rpm": map[string]any{"unit": "requests", "limit": 600, "per": "1m"}},
		}}},
		{"mcp/servers", "docs", map[string]any{"url": "", "enabled": true, "description": "Local notes server"}},
		{"a2a/agents", "helper", map[string]any{"description": "Sample agent", "enabled": true}},
		{"plugins", "redact-email", map[string]any{"enabled": false, "description": "Wasm plugins are stored here and are not executed in this build."}},
		{"alerts/rules", "budget-80", map[string]any{"enabled": true, "severity": "warning", "summary": "Budget at 80%"}},
		{"alerts/channels", "log", map[string]any{"type": "log", "enabled": true}},
	}
	for _, item := range specs {
		if _, err := s.Put(item.col, item.name, item.spec, "", false); err != nil {
			return fmt.Errorf("seed %s/%s: %w", item.col, item.name, err)
		}
	}
	return nil
}
