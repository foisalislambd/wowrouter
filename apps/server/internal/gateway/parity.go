package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"wowrouter/server/internal/combo"
)

func (e *Engine) setting(name string) map[string]any {
	if e == nil || e.Cat == nil {
		return nil
	}
	spec, _, ok := e.Cat.Resource("settings", name)
	if !ok {
		return nil
	}
	return spec
}

func (e *Engine) planCombo(call Call) ([]Leaf, string, error) {
	strategy := call.Model
	var targets []map[string]any
	if strings.HasPrefix(call.Model, "combo:") {
		name := strings.TrimPrefix(call.Model, "combo:")
		spec, _, ok := e.Cat.Resource("combos", name)
		if !ok {
			return nil, "", fmt.Errorf("combo %s not found", name)
		}
		strategy = asString(spec["strategy"])
		if strategy == "" {
			strategy = "priority"
		}
		for _, item := range asSlice(spec["targets"]) {
			if row := asMap(item); row != nil {
				targets = append(targets, row)
			}
		}
	}
	allow := map[string]bool{}
	weight := map[string]float64{}
	if len(targets) > 0 {
		for _, row := range targets {
			id := asString(row["deployment"])
			if id == "" {
				id = asString(row["id"])
			}
			if id != "" {
				allow[id] = true
				if w := asFloat(row["weight"]); w > 0 {
					weight[id] = w
				}
			}
		}
	}
	now := time.Now()
	if e.Now != nil {
		now = e.Now()
	}
	last := ""
	if e.Breakers != nil {
		last = e.Breakers.Last(call.KeyName)
	}
	var cands []combo.Candidate
	byID := map[string]Leaf{}
	for _, dep := range e.Cat.Resources("deployments") {
		if dep.Spec["enabled"] == false {
			continue
		}
		if len(allow) > 0 && !allow[dep.Name] {
			continue
		}
		provider := asString(dep.Spec["provider"])
		upstream := asString(dep.Spec["model"])
		if provider == "" || upstream == "" {
			continue
		}
		pspec, _, _ := e.Cat.Resource("providers", provider)
		healthy := true
		var latency float64
		var inflight int
		var quota float64
		if e.Breakers != nil {
			healthy = e.Breakers.Allow(provider) && e.Breakers.ModelAllowed(provider, upstream)
			latency = e.Breakers.Latency(provider)
			inflight = e.Breakers.InFlight(provider)
			quota = e.Breakers.Quota(provider)
		}
		if quota <= 0 {
			quota = asFloat(dep.Spec["quota"])
		}
		if quota <= 0 {
			quota = 1
		}
		w := weight[dep.Name]
		if w <= 0 {
			w = asFloat(dep.Spec["weight"])
		}
		if w <= 0 {
			w = 1
		}
		var reset time.Time
		if raw := asString(dep.Spec["reset"]); raw != "" {
			reset, _ = time.Parse(time.RFC3339, raw)
		}
		cands = append(cands, combo.Candidate{
			ID:           dep.Name,
			Provider:     provider,
			Weight:       w,
			Cost:         asFloat(dep.Spec["price_in"]),
			Quota:        quota,
			Reset:        reset,
			InFlight:     inflight,
			Latency:      latency,
			Context:      int(asFloat(dep.Spec["context_window"])),
			LastGood:     dep.Name == last,
			Healthy:      healthy,
			Subscription: pspec["subscription"] == true,
			Quality:      asFloat(dep.Spec["quality"]),
		})
		byID[dep.Name] = Leaf{
			Provider:   provider,
			Deployment: dep.Name,
			Upstream:   upstream,
			Trail:      []string{call.Model, dep.Name},
			PriceIn:    asFloat(dep.Spec["price_in"]),
			PriceOut:   asFloat(dep.Spec["price_out"]),
		}
	}
	req := combo.Request{
		Now:           now,
		Session:       call.KeyName,
		ContextTokens: len(MessageText(call.Body)) / 4,
		Rand:          float64(now.UnixNano()%10000) / 10000,
	}
	if e.Breakers != nil {
		req.Cursor = e.Breakers.TakeCursor(call.Model)
	}
	res := combo.Order(strategy, cands, req)
	if len(res.Attempts) == 0 {
		if strategy == "auto/subscription" {
			return nil, res.Mode, fmt.Errorf("auto/subscription has no subscription quota")
		}
		return nil, res.Mode, fmt.Errorf("the route has no deployment")
	}
	var leaves []Leaf
	for _, id := range res.Attempts {
		if leaf, ok := byID[id]; ok {
			leaves = append(leaves, leaf)
		}
	}
	return leaves, res.Mode, nil
}

func (e *Engine) fanout(call Call, leaves []Leaf, finish func(Leaf, int, []byte) Outcome, out *Outcome) Outcome {
	var choices []any
	var last Leaf
	for _, leaf := range leaves {
		out.Attempts++
		status, payload, err := e.one(leaf, call.Body)
		if err != nil || status >= 400 {
			continue
		}
		last = leaf
		choices = append(choices, map[string]any{
			"index":         len(choices),
			"message":       map[string]any{"role": "assistant", "content": ResponseText(payload)},
			"finish_reason": "stop",
			"provider":      leaf.Provider,
		})
	}
	if len(choices) == 0 {
		out.Status = http.StatusBadGateway
		out.Error = "upstream failed"
		out.Body = errorBody(out.Error)
		e.log(call, *out, nil)
		return *out
	}
	raw, _ := json.Marshal(map[string]any{
		"id": "chatcmpl-fanout", "object": "chat.completion", "model": call.Model, "choices": choices,
	})
	return finish(last, http.StatusOK, raw)
}

func (e *Engine) pipeline(call Call, leaves []Leaf, finish func(Leaf, int, []byte) Outcome, out *Outcome) Outcome {
	body := call.Body
	var last Leaf
	var payload []byte
	for i, leaf := range leaves {
		out.Attempts++
		status, raw, err := e.one(leaf, body)
		if err != nil || status >= 400 {
			out.Status = http.StatusBadGateway
			out.Error = errString(err, status)
			if out.Error == "" {
				out.Error = "upstream failed"
			}
			out.Body = errorBody(out.Error)
			e.log(call, *out, nil)
			return *out
		}
		last = leaf
		payload = raw
		if i == len(leaves)-1 {
			break
		}
		body = map[string]any{
			"model": call.Model,
			"messages": []any{map[string]any{
				"role": "user", "content": ResponseText(raw),
			}},
		}
	}
	return finish(last, http.StatusOK, payload)
}

func scrubHeaderMap(h map[string]string) {
	for k := range h {
		switch strings.ToLower(k) {
		case "authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization":
			delete(h, k)
		}
	}
}
