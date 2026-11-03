package gateway

import "strings"

type keySlot struct {
	ID     string
	Secret string
}

// collectKeys lists every usable credential on a provider.
// Accounts and api_keys are all included. A disabled or redacted entry is skipped.
func collectKeys(spec, priv map[string]any) []keySlot {
	var out []keySlot
	seen := map[string]bool{}
	usedID := map[string]int{}
	add := func(id, secret string) {
		secret = strings.TrimSpace(secret)
		if secret == "" || secret == "[REDACTED]" || seen[secret] {
			return
		}
		seen[secret] = true
		if id == "" {
			id = "key"
		}
		usedID[id]++
		if usedID[id] > 1 {
			id = id + "-" + itoa(usedID[id])
		}
		out = append(out, keySlot{ID: id, Secret: secret})
	}
	for _, src := range []map[string]any{priv, spec} {
		for i, item := range asSlice(src["accounts"]) {
			acc := asMap(item)
			if acc["enabled"] == false {
				continue
			}
			id := asString(acc["id"])
			if id == "" {
				id = asString(acc["name"])
			}
			if id == "" {
				id = "account-" + itoa(i)
			}
			add(id, asString(acc["api_key"]))
		}
		auth := asMap(src["auth"])
		for i, item := range asSlice(auth["api_keys"]) {
			row := asMap(item)
			if row["enabled"] == false {
				continue
			}
			id := asString(row["id"])
			if id == "" {
				id = asString(row["name"])
			}
			if id == "" {
				id = "key-" + itoa(i)
			}
			add(id, asString(row["key"]))
		}
		add("api_key", asString(auth["api_key"]))
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func (e *Engine) pickKey(provider string, spec, priv map[string]any) (id, secret string) {
	if access, ok := freshToken(e, provider); ok && access != "" {
		priv = overlayKey(priv, access)
	}
	slots := collectKeys(spec, priv)
	if len(slots) == 0 {
		return "", ""
	}
	strategy := asString(spec["account_strategy"])
	if strategy == "" {
		strategy = asString(priv["account_strategy"])
	}
	live := make([]keySlot, 0, len(slots))
	for _, slot := range slots {
		if e.cooled(provider, slot.ID) {
			continue
		}
		live = append(live, slot)
	}
	if len(live) == 0 {
		return "", ""
	}
	switch strategy {
	case "", "round-robin", "least-used", "p2c":
		if e == nil || e.Breakers == nil {
			return live[0].ID, live[0].Secret
		}
		ids := make([]string, len(live))
		by := make(map[string]string, len(live))
		for i, slot := range live {
			ids[i] = slot.ID
			by[slot.ID] = slot.Secret
		}
		chosen, ok := e.Breakers.NextKey(provider, ids)
		if !ok {
			return "", ""
		}
		return chosen, by[chosen]
	case "random", "strict-random":
		n := 0
		if e != nil && e.Breakers != nil {
			n = e.Breakers.TakeCursor(provider)
		}
		slot := live[n%len(live)]
		return slot.ID, slot.Secret
	default:
		// fill-first and priority stay on the first live account.
		return live[0].ID, live[0].Secret
	}
}

func (e *Engine) cooled(provider, id string) bool {
	return e != nil && e.Breakers != nil && e.Breakers.KeyCooling(provider, id)
}

func freshToken(e *Engine, provider string) (string, bool) {
	if e == nil || e.Cat == nil || provider == "" {
		return "", false
	}
	keeper, ok := e.Cat.(interface {
		EnsureFreshToken(string) (string, bool)
	})
	if !ok {
		return "", false
	}
	return keeper.EnsureFreshToken(provider)
}

func overlayKey(priv map[string]any, access string) map[string]any {
	out := map[string]any{}
	for k, v := range priv {
		out[k] = v
	}
	auth := map[string]any{}
	for k, v := range asMap(out["auth"]) {
		auth[k] = v
	}
	auth["api_key"] = access
	out["auth"] = auth
	return out
}
