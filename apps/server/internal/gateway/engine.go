package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Call struct {
	Model        string
	Body         map[string]any
	KeyName      string
	Organization string
	Team         string
	Project      string
	Tags         []string
	Dialect      string
}

type Outcome struct {
	Status   int
	Body     []byte
	Model    string
	Provider string
	Cached   bool
	Blocked  bool
	Flagged  bool
	Route    string
	Trail    []string
	Attempts int
	CostUSD  float64
	Prompt   int
	Output   int
	Latency  time.Duration
	Error    string
}

type Ledger interface {
	Reader
	AllowRate(bucket string, limit int, window time.Duration) bool
	SpendOf(bucket string) float64
	AddSpend(bucket string, usd float64, tokens int) float64
	CacheGet(key string) (string, bool)
	CachePut(key, model, prompt, response, vector string, exact bool)
	CacheSemantic(model, prompt string, threshold float64) (string, float64, bool)
	AddLog(rec map[string]any)
	PutAlert(a map[string]any)
}

type Engine struct {
	Cat      Ledger
	HTTP     *http.Client
	Breakers *Breakers
	Now      func() time.Time
}

func New(cat Ledger) *Engine {
	return &Engine{Cat: cat, HTTP: &http.Client{Timeout: 60 * time.Second}, Breakers: NewBreakers(), Now: time.Now}
}

func (e *Engine) Owns(model string) bool {
	if e == nil || e.Cat == nil || strings.Contains(model, "/") {
		return false
	}
	_, _, ok := e.Cat.Resource("models", model)
	return ok
}

func (e *Engine) Handle(call Call) Outcome {
	started := e.Now()
	out := Outcome{Status: http.StatusBadGateway, Model: call.Model}
	modelSpec, _, ok := e.Cat.Resource("models", call.Model)
	if !ok || modelSpec["enabled"] == false {
		out.Status = http.StatusNotFound
		out.Error = "model not found"
		out.Body = errorBody(out.Error)
		e.log(call, out, nil)
		return out
	}
	text := MessageText(call.Body)
	guards := e.Cat.Resources("guardrails")
	in := Apply(guards, text, "input")
	if len(in.Hits) > 0 {
		out.Flagged = in.Flagged || len(in.Hits) > 0
		RewriteMessages(call.Body, in.Text)
		text = in.Text
	}
	if in.Blocked {
		out.Status = http.StatusBadRequest
		out.Blocked = true
		out.Error = "blocked by a guardrail"
		out.Body = errorBody(out.Error)
		out.Latency = e.Now().Sub(started)
		e.log(call, out, in.Hits)
		return out
	}
	if err := e.enforce(call, 0); err != nil {
		out.Status = http.StatusTooManyRequests
		out.Error = err.Error()
		out.Body = errorBody(out.Error)
		out.Latency = e.Now().Sub(started)
		e.log(call, out, in.Hits)
		return out
	}
	if cached, hit := e.readCache(call, text); hit {
		out.Status = http.StatusOK
		out.Body = []byte(cached)
		out.Cached = true
		out.Latency = e.Now().Sub(started)
		e.log(call, out, in.Hits)
		return out
	}
	tree, routeName := e.tree(modelSpec)
	facts := Facts{
		Text: text, Team: call.Team, Organization: call.Organization, Project: call.Project, Key: call.KeyName, Tags: call.Tags,
		InputTokens: len(text) / 4,
		Latency:     e.Breakers.Latency,
		InFlight:    e.Breakers.InFlight,
		Allow:       e.Breakers.Allow,
		Rand:        float64(started.UnixNano()%1000) / 1000,
	}
	leaves, blocked := Plan(tree, e.Cat, facts)
	out.Route = routeName
	if blocked {
		out.Status = http.StatusBadRequest
		out.Blocked = true
		out.Error = "blocked by the route"
		out.Body = errorBody(out.Error)
		out.Latency = e.Now().Sub(started)
		e.log(call, out, in.Hits)
		return out
	}
	if len(leaves) == 0 {
		out.Status = http.StatusNotFound
		out.Error = "the route has no deployment"
		out.Body = errorBody(out.Error)
		out.Latency = e.Now().Sub(started)
		e.log(call, out, in.Hits)
		return out
	}
	var lastErr string
	retries := retryCount(modelSpec)
	hedge := hedgeDelay(modelSpec)
	finish := func(leaf Leaf, status int, payload []byte) Outcome {
		out.Status = status
		out.Body = payload
		out.Provider = leaf.Provider
		out.Model = call.Model
		out.Trail = append(out.Trail, leaf.Trail...)
		out.Prompt, out.Output = usageOf(payload)
		if out.Prompt == 0 {
			out.Prompt = len(text) / 4
		}
		out.CostUSD = PriceUSD(leaf.PriceIn, leaf.PriceOut, out.Prompt, out.Output)
		respText := ResponseText(payload)
		after := Apply(guards, respText, "output")
		if len(after.Hits) > 0 {
			out.Flagged = true
			in.Hits = append(in.Hits, after.Hits...)
			if after.Blocked {
				out.Status = http.StatusBadRequest
				out.Blocked = true
				out.Error = "response blocked by a guardrail"
				out.Body = errorBody(out.Error)
				out.Latency = e.Now().Sub(started)
				e.charge(call, out.CostUSD, out.Prompt+out.Output)
				e.log(call, out, in.Hits)
				return out
			}
			if after.Text != "" && after.Text != respText {
				out.Body = RewriteResponse(payload, after.Text)
			}
		}
		if status < 400 {
			e.writeCache(call, text, out.Body)
			e.charge(call, out.CostUSD, out.Prompt+out.Output)
		}
		out.Latency = e.Now().Sub(started)
		e.log(call, out, in.Hits)
		return out
	}
	for i := 0; i < len(leaves); {
		if hedge > 0 && i+1 < len(leaves) {
			leaf, status, payload, err := e.hedged(leaves[i], leaves[i+1], call.Body, hedge, &out.Attempts)
			if err == nil && status > 0 && status < 500 && status != http.StatusTooManyRequests {
				return finish(leaf, status, payload)
			}
			lastErr = errString(err, status)
			i += 2
			continue
		}
		leaf := leaves[i]
		for attempt := 0; attempt <= retries; attempt++ {
			out.Attempts++
			status, payload, err := e.one(leaf, call.Body)
			if err != nil || status >= 500 || status == http.StatusTooManyRequests {
				lastErr = errString(err, status)
				continue
			}
			return finish(leaf, status, payload)
		}
		i++
	}
	out.Status = http.StatusBadGateway
	out.Error = lastErr
	if out.Error == "" {
		out.Error = "upstream failed"
	}
	out.Body = errorBody(out.Error)
	out.Latency = e.Now().Sub(started)
	e.log(call, out, in.Hits)
	return out
}

func (e *Engine) tree(model map[string]any) (map[string]any, string) {
	if route := asString(model["route"]); route != "" {
		spec, _, ok := e.Cat.Resource("routes", route)
		if ok {
			return asMap(spec["tree"]), route
		}
	}
	if target := asMap(model["target"]); target != nil {
		return target, ""
	}
	return nil, ""
}

func (e *Engine) enforce(call Call, extraTokens int) error {
	owners := e.owners(call)
	for _, owner := range owners {
		for _, lim := range LimitsOf(owner.level, owner.name, owner.spec) {
			if lim.Unit == "requests" && !e.Cat.AllowRate(lim.Level+"/"+lim.Owner+"/"+lim.Name, lim.Limit, lim.Window) {
				return fmt.Errorf("rate limit %s on %s %s", lim.Name, lim.Level, lim.Owner)
			}
		}
		for _, b := range BudgetsOf(owner.level, owner.name, owner.spec) {
			if b.Unit != "" && b.Unit != "usd" {
				continue
			}
			spent := e.Cat.SpendOf(Bucket(b.Level, b.Owner, b.Name, b.Period, e.Now()))
			if b.Mode == "hard" && b.Amount > 0 && spent >= b.Amount {
				return fmt.Errorf("budget %s on %s %s is spent", b.Name, b.Level, b.Owner)
			}
			if b.Amount > 0 {
				ratio := spent / b.Amount
				for _, at := range b.Alerts {
					if ratio >= at {
						e.Cat.PutAlert(map[string]any{
							"id":   fmt.Sprintf("budget-%s-%s-%s", b.Level, b.Owner, b.Name),
							"rule": "budget", "fingerprint": b.Level + "/" + b.Owner + "/" + b.Name,
							"category": "budget", "severity": "warning", "status": "firing",
							"fired_at": e.Now().UTC().Format(time.RFC3339),
							"summary":  fmt.Sprintf("%s %s budget %s is at %.0f%%", b.Level, b.Owner, b.Name, ratio*100),
							"value":    ratio, "threshold": at,
						})
					}
				}
			}
		}
	}
	_ = extraTokens
	return nil
}

type owner struct {
	level, name string
	spec        map[string]any
}

func (e *Engine) owners(call Call) []owner {
	var out []owner
	add := func(level, name string) {
		if name == "" {
			return
		}
		spec, _, ok := e.Cat.Resource(level+"s", name)
		if level == "key" {
			spec, _, ok = e.Cat.Resource("keys", name)
		}
		if ok {
			out = append(out, owner{level: level, name: name, spec: spec})
		}
	}
	add("organization", call.Organization)
	add("team", call.Team)
	add("project", call.Project)
	add("key", call.KeyName)
	return out
}

func (e *Engine) charge(call Call, usd float64, tokens int) {
	if usd == 0 && tokens == 0 {
		return
	}
	for _, owner := range e.owners(call) {
		for _, b := range BudgetsOf(owner.level, owner.name, owner.spec) {
			e.Cat.AddSpend(Bucket(b.Level, b.Owner, b.Name, b.Period, e.Now()), usd, tokens)
		}
	}
}

func (e *Engine) cacheOn() (exact bool, semantic bool, threshold float64) {
	exact = true
	threshold = 0.92
	spec, _, ok := e.Cat.Resource("settings", "cache")
	if !ok {
		return exact, false, threshold
	}
	if spec["enabled"] == false {
		exact = false
	}
	if asMap(spec["exact"])["enabled"] == false {
		exact = false
	}
	sem := asMap(spec["semantic"])
	semantic = sem["enabled"] == true
	if asFloat(sem["threshold"]) > 0 {
		threshold = asFloat(sem["threshold"])
	}
	return exact, semantic, threshold
}

func (e *Engine) readCache(call Call, text string) (string, bool) {
	exact, semantic, threshold := e.cacheOn()
	if exact {
		if resp, ok := e.Cat.CacheGet(ExactKey(call.Model, call.Body)); ok {
			return resp, true
		}
	}
	if semantic {
		if resp, _, ok := e.Cat.CacheSemantic(call.Model, text, threshold); ok {
			return resp, true
		}
	}
	return "", false
}

func (e *Engine) writeCache(call Call, text string, body []byte) {
	exact, semantic, _ := e.cacheOn()
	if exact {
		e.Cat.CachePut(ExactKey(call.Model, call.Body), call.Model, text, string(body), "", true)
	}
	if semantic {
		raw, _ := json.Marshal(bowMap(text))
		e.Cat.CachePut("sem:"+ExactKey(call.Model, call.Body), call.Model, text, string(body), string(raw), false)
	}
}

func bowMap(text string) map[string]float64 {
	out := map[string]float64{}
	for _, w := range strings.Fields(strings.ToLower(text)) {
		w = strings.Trim(w, ".,!?;:\"'()[]{}")
		if len(w) > 1 {
			out[w]++
		}
	}
	return out
}

func (e *Engine) one(leaf Leaf, body map[string]any) (int, []byte, error) {
	started := e.Now()
	e.Breakers.AddInFlight(leaf.Deployment, 1)
	status, payload, err := e.callUpstream(context.Background(), leaf, body)
	e.Breakers.AddInFlight(leaf.Deployment, -1)
	e.note(leaf.Deployment, float64(e.Now().Sub(started).Milliseconds()), status, err)
	return status, payload, err
}

// hedged starts the first leaf and, after delay, the second. The first acceptable answer wins.
func (e *Engine) hedged(a, b Leaf, body map[string]any, delay time.Duration, attempts *int) (Leaf, int, []byte, error) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type result struct {
		leaf   Leaf
		status int
		body   []byte
		err    error
	}
	ch := make(chan result, 2)
	launch := func(leaf Leaf) {
		*attempts++
		go func() {
			started := e.Now()
			e.Breakers.AddInFlight(leaf.Deployment, 1)
			status, payload, err := e.callUpstream(ctx, leaf, body)
			e.Breakers.AddInFlight(leaf.Deployment, -1)
			if ctx.Err() != nil && (err != nil || status == 0) {
				return
			}
			e.note(leaf.Deployment, float64(e.Now().Sub(started).Milliseconds()), status, err)
			ch <- result{leaf, status, payload, err}
		}()
	}
	acceptable := func(r result) bool {
		return r.err == nil && r.status > 0 && r.status < 500 && r.status != http.StatusTooManyRequests
	}
	launch(a)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	pending := 1
	second := false
	var last result
	for pending > 0 {
		select {
		case r := <-ch:
			pending--
			last = r
			if acceptable(r) {
				cancel()
				return r.leaf, r.status, r.body, nil
			}
			if !second {
				second = true
				pending++
				launch(b)
			}
		case <-timer.C:
			if !second {
				second = true
				pending++
				launch(b)
			}
		}
	}
	if last.err != nil {
		return a, last.status, nil, last.err
	}
	return a, last.status, last.body, nil
}

func (e *Engine) note(name string, ms float64, status int, err error) {
	if err != nil && errors.Is(err, context.Canceled) {
		return
	}
	if err != nil || status >= 500 || status == http.StatusTooManyRequests {
		e.Breakers.Note(name, ms, false)
		return
	}
	if status >= 400 {
		e.Breakers.LatencyOnly(name, ms)
		return
	}
	e.Breakers.Note(name, ms, true)
}

func (e *Engine) callUpstream(ctx context.Context, leaf Leaf, body map[string]any) (int, []byte, error) {
	pspec, ppriv, ok := e.Cat.Resource("providers", leaf.Provider)
	if !ok {
		return 0, nil, fmt.Errorf("provider %s is not configured", leaf.Provider)
	}
	base := asString(ppriv["base_url"])
	if base == "" {
		base = asString(pspec["base_url"])
	}
	if base == "" {
		base = defaultBase(asString(pspec["type"]))
	}
	if base == "" {
		return 0, nil, fmt.Errorf("provider %s has no base URL", leaf.Provider)
	}
	if err := SafeHTTPURL(base); err != nil {
		return 0, nil, err
	}
	path, payload, headers := ToUpstream(asString(pspec["type"]), body, leaf.Upstream)
	key := asString(asMap(ppriv["auth"])["api_key"])
	if key == "" {
		key = asString(asMap(pspec["auth"])["api_key"])
	}
	if key == "[REDACTED]" {
		key = ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+path, bytes.NewReader(payload))
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	ptype := asString(pspec["type"])
	if key != "" {
		if ptype == "azure" || ptype == "azure_openai" {
			req.Header.Set("api-key", key)
		} else if ptype == "anthropic" || ptype == "anthropic_compatible" {
			req.Header.Set("x-api-key", key)
		} else if ptype == "gemini" {
			q := req.URL.Query()
			q.Set("key", key)
			req.URL.RawQuery = q.Encode()
		} else {
			req.Header.Set("Authorization", "Bearer "+key)
		}
	}
	client := *e.HTTP
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("stopped after 3 redirects")
		}
		return SafeHTTPURL(req.URL.String())
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	if ptype == "anthropic" || ptype == "anthropic_compatible" || ptype == "gemini" {
		raw = normalizeUpstream(ptype, leaf.Upstream, raw)
	}
	return resp.StatusCode, raw, nil
}

func normalizeUpstream(ptype, model string, raw []byte) []byte {
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return raw
	}
	text := ""
	switch ptype {
	case "anthropic", "anthropic_compatible":
		for _, block := range asSlice(body["content"]) {
			text += asString(asMap(block)["text"])
		}
	case "gemini":
		for _, cand := range asSlice(body["candidates"]) {
			for _, part := range asSlice(asMap(asMap(cand)["content"])["parts"]) {
				text += asString(asMap(part)["text"])
			}
		}
	}
	if text == "" {
		return raw
	}
	out, _ := json.Marshal(map[string]any{
		"id": "chatcmpl-wowrouter", "object": "chat.completion", "model": model,
		"choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": text}, "finish_reason": "stop"}},
	})
	return out
}

func defaultBase(ptype string) string {
	switch ptype {
	case "openai":
		return "https://api.openai.com/v1"
	case "anthropic":
		return "https://api.anthropic.com"
	case "gemini":
		return "https://generativelanguage.googleapis.com/v1beta"
	case "groq":
		return "https://api.groq.com/openai/v1"
	case "together":
		return "https://api.together.xyz/v1"
	case "fireworks":
		return "https://api.fireworks.ai/inference/v1"
	case "deepseek":
		return "https://api.deepseek.com/v1"
	case "xai":
		return "https://api.x.ai/v1"
	case "mistral":
		return "https://api.mistral.ai/v1"
	case "cerebras":
		return "https://api.cerebras.ai/v1"
	case "deepinfra":
		return "https://api.deepinfra.com/v1/openai"
	case "perplexity":
		return "https://api.perplexity.ai"
	case "cohere":
		return "https://api.cohere.ai/compatibility/v1"
	default:
		return ""
	}
}

func retryCount(model map[string]any) int {
	res := asMap(asMap(model["policies"])["resilience"])
	n := int(asFloat(asMap(res["retry"])["tier_retries"]))
	if n < 0 {
		return 0
	}
	if n > 4 {
		return 4
	}
	return n
}

func hedgeDelay(model map[string]any) time.Duration {
	res := asMap(asMap(model["policies"])["resilience"])
	h := asMap(res["hedging"])
	if h["enabled"] != true {
		return 0
	}
	d, err := time.ParseDuration(asString(h["delay"]))
	if err != nil || d <= 0 {
		return 200 * time.Millisecond
	}
	return d
}

func usageOf(payload []byte) (int, int) {
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil {
		return 0, 0
	}
	usage := asMap(body["usage"])
	return int(asFloat(usage["prompt_tokens"])), int(asFloat(usage["completion_tokens"]))
}

func errorBody(message string) []byte {
	raw, _ := json.Marshal(map[string]any{"error": map[string]any{"message": message, "type": "invalid_request_error"}})
	return raw
}

func errString(err error, status int) string {
	if err != nil {
		return err.Error()
	}
	return fmt.Sprintf("upstream status %d", status)
}

func (e *Engine) log(call Call, out Outcome, hits []GuardHit) {
	id := fmt.Sprintf("req_%d", e.Now().UnixNano())
	guards := []any{}
	for _, hit := range hits {
		guards = append(guards, map[string]any{"name": hit.Name, "action": hit.Action, "category": hit.Category, "detail": hit.Detail})
	}
	rec := map[string]any{
		"schema_version": 1, "id": id, "request_id": id, "trace_id": id, "span_id": id,
		"node_id": "wowrouter", "gateway_version": "wowrouter", "config_generation": 1,
		"started_at": e.Now().Add(-out.Latency).UTC().Format(time.RFC3339Nano),
		"ended_at":   e.Now().UTC().Format(time.RFC3339Nano),
		"method":     "POST", "endpoint": "/v1/chat/completions", "operation": "chat", "dialect": call.Dialect,
		"stream": nil, "client_ip": "127.0.0.1", "user_agent": nil, "client_retry_count": nil,
		"organization": emptyNil(call.Organization), "team": emptyNil(call.Team), "project": emptyNil(call.Project),
		"key": emptyNil(call.KeyName), "end_user": nil, "tags": call.Tags, "metadata": map[string]string{},
		"metadata_dropped": 0, "session_id": nil,
		"requested_model": call.Model, "model": call.Model, "route": emptyNil(out.Route), "provider": emptyNil(out.Provider),
		"deployment": nil, "upstream_model": nil, "response_model": call.Model, "upstream_request_id": nil,
		"response_path": "choices.0.message.content", "status_code": out.Status, "code": nil, "reason": nil, "stage": nil,
		"error_message": emptyNil(out.Error), "finish_reasons": []string{}, "stop_category": nil, "client_disconnected": false,
		"attempt_count": out.Attempts, "attempts": []any{}, "skipped_candidates": []any{}, "translation_warnings": []string{},
		"params_applied": map[string]any{}, "cache": map[string]any{"hit": out.Cached}, "admission": nil,
		"degraded": []any{}, "guardrails": guards, "extensions": []any{},
		"usage":           map[string]any{"input": out.Prompt, "output": out.Output},
		"cost":            map[string]any{"usd": fmt.Sprintf("%.6f", out.CostUSD)},
		"timing":          map[string]any{"total_ms": out.Latency.Milliseconds()},
		"request_headers": map[string]string{}, "response_headers": map[string]string{},
		"content": nil, "mcp": nil, "a2a": nil, "route_path": strings.Join(out.Trail, " | "),
	}
	if call.Dialect == "" {
		rec["dialect"] = "openai"
	}
	e.Cat.AddLog(rec)
}

func emptyNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}
