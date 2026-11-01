package gateway

import (
	"math/rand"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Named struct {
	Name    string
	Spec    map[string]any
	Private map[string]any
}

type Reader interface {
	Resource(collection, name string) (map[string]any, map[string]any, bool)
	Resources(collection string) []Named
}

type Leaf struct {
	Provider   string
	Deployment string
	Upstream   string
	Trail      []string
	PriceIn    float64
	PriceOut   float64
}

type Facts struct {
	Text         string
	Team         string
	Organization string
	Project      string
	Key          string
	Tags         []string
	InputTokens  int
	Latency      func(name string) float64
	InFlight     func(name string) int
	Allow        func(name string) bool
	Rand         float64
}

func (f Facts) latency(name string) float64 {
	if f.Latency == nil || name == "" {
		return 1e9
	}
	v := f.Latency(name)
	if v <= 0 {
		return 1e9
	}
	return v
}

func (f Facts) inflight(name string) int {
	if f.InFlight == nil {
		return 0
	}
	return f.InFlight(name)
}

func (f Facts) allow(name string) bool {
	if f.Allow == nil || name == "" {
		return true
	}
	return f.Allow(name)
}

// Plan returns ordered attempts. A fallback yields every child; other nodes yield the chosen child.
func Plan(node map[string]any, cat Reader, facts Facts) (leaves []Leaf, blocked bool) {
	if node == nil {
		return nil, false
	}
	kind := kindOf(node)
	switch kind {
	case "deployment":
		leaf, ok := leafFromDeployment(asString(node["deployment"]), cat, facts)
		if !ok {
			return nil, false
		}
		leaf.Trail = trail(node, leaf.Deployment)
		return []Leaf{leaf}, false
	case "provider_model":
		leaf := Leaf{Provider: asString(node["provider"]), Upstream: asString(node["upstream_model"]), Deployment: asString(node["provider"]) + "/" + asString(node["upstream_model"])}
		leaf.Trail = trail(node, leaf.Deployment)
		if !facts.allow(leaf.Deployment) {
			return nil, false
		}
		return []Leaf{leaf}, false
	case "route":
		spec, _, ok := cat.Resource("routes", asString(node["route"]))
		if !ok {
			return nil, false
		}
		return Plan(asMap(spec["tree"]), cat, facts)
	case "fallback":
		var out []Leaf
		sawBlock := false
		for _, child := range asSlice(node["children"]) {
			got, blockedChild := Plan(asMap(child), cat, facts)
			if blockedChild {
				sawBlock = true
				continue
			}
			out = append(out, got...)
		}
		if len(out) == 0 && sawBlock {
			return nil, true
		}
		return out, false
	case "weighted", "pool":
		return Plan(pickWeighted(asSlice(node["children"]), facts.Rand), cat, facts)
	case "least_cost":
		return Plan(pickLeast(asSlice(node["children"]), cat, facts, func(l Leaf) float64 { return l.PriceIn + 3*l.PriceOut }), cat, facts)
	case "least_latency":
		return Plan(pickLeast(asSlice(node["children"]), cat, facts, func(l Leaf) float64 { return facts.latency(l.Deployment) }), cat, facts)
	case "least_busy":
		return Plan(pickLeast(asSlice(node["children"]), cat, facts, func(l Leaf) float64 { return float64(facts.inflight(l.Deployment)) }), cat, facts)
	case "conditional":
		for _, rule := range asSlice(node["rules"]) {
			rm := asMap(rule)
			if rm["enabled"] == false {
				continue
			}
			if matchWhen(asMap(rm["when"]), facts) {
				return Plan(asMap(rm["target"]), cat, facts)
			}
		}
		if def := asMap(node["default"]); def != nil {
			return Plan(def, cat, facts)
		}
		return nil, false
	case "classifier":
		text := strings.ToLower(facts.Text)
		for _, class := range asSlice(node["classes"]) {
			cm := asMap(class)
			if keywordHit(text, cm) || regexHit(text, cm) {
				return Plan(asMap(cm["target"]), cat, facts)
			}
		}
		return Plan(asMap(node["default"]), cat, facts)
	case "cost_quality":
		strong := len(facts.Text) > 2000 || facts.Rand < asFloat(node["strong_fraction"])
		if strong {
			return Plan(asMap(node["strong"]), cat, facts)
		}
		return Plan(asMap(node["weak"]), cat, facts)
	case "tier":
		return Plan(pickLeast(asSlice(node["children"]), cat, facts, func(l Leaf) float64 { return l.PriceIn + l.PriceOut }), cat, facts)
	case "block":
		return nil, true
	default:
		if asString(node["deployment"]) != "" {
			return Plan(map[string]any{"type": "deployment", "deployment": node["deployment"]}, cat, facts)
		}
		return nil, false
	}
}

func kindOf(node map[string]any) string {
	if t := asString(node["type"]); t != "" {
		return t
	}
	switch {
	case node["deployment"] != nil:
		return "deployment"
	case node["upstream_model"] != nil:
		return "provider_model"
	case node["route"] != nil && node["children"] == nil && node["rules"] == nil:
		return "route"
	case node["children"] != nil:
		return "fallback"
	case node["rules"] != nil:
		return "conditional"
	case node["classes"] != nil:
		return "classifier"
	case node["strong"] != nil:
		return "cost_quality"
	default:
		return ""
	}
}

func trail(node map[string]any, leaf string) []string {
	id := asString(node["id"])
	if id == "" {
		id = kindOf(node)
	}
	return []string{id + " → " + leaf}
}

func leafFromDeployment(name string, cat Reader, facts Facts) (Leaf, bool) {
	if !facts.allow(name) {
		return Leaf{}, false
	}
	spec, _, ok := cat.Resource("deployments", name)
	if !ok || spec["enabled"] == false {
		return Leaf{}, false
	}
	provider := asString(spec["provider"])
	if pspec, _, ok := cat.Resource("providers", provider); ok && pspec["enabled"] == false {
		return Leaf{}, false
	}
	price := asMap(spec["price"])
	return Leaf{
		Provider:   provider,
		Deployment: name,
		Upstream:   asString(spec["model"]),
		PriceIn:    asFloat(price["input"]),
		PriceOut:   asFloat(price["output"]),
	}, true
}

func pickWeighted(children []any, roll float64) map[string]any {
	if len(children) == 0 {
		return nil
	}
	total := 0.0
	weights := make([]float64, len(children))
	for i, child := range children {
		w := asFloat(asMap(child)["weight"])
		if w <= 0 {
			w = 1
		}
		weights[i] = w
		total += w
	}
	if roll <= 0 || roll >= 1 {
		roll = rand.Float64()
	}
	cursor := roll * total
	for i, w := range weights {
		cursor -= w
		if cursor <= 0 {
			return asMap(children[i])
		}
	}
	return asMap(children[len(children)-1])
}

func pickLeast(children []any, cat Reader, facts Facts, score func(Leaf) float64) map[string]any {
	best := 1e99
	var chosen map[string]any
	for _, child := range children {
		cm := asMap(child)
		leaves, _ := Plan(cm, cat, facts)
		if len(leaves) == 0 {
			continue
		}
		s := score(leaves[0])
		if s < best {
			best = s
			chosen = cm
		}
	}
	return chosen
}

func matchWhen(when map[string]any, facts Facts) bool {
	if len(when) == 0 {
		return true
	}
	field := asString(when["field"])
	value := fieldValue(field, facts)
	if eq, ok := when["eq"]; ok {
		return value == asString(eq)
	}
	if contains, ok := when["contains"]; ok {
		return strings.Contains(strings.ToLower(value), strings.ToLower(asString(contains)))
	}
	if _, ok := when["gt"]; ok {
		n := asFloat(value)
		switch field {
		case "request.text_length":
			n = float64(len(facts.Text))
		case "request.input_tokens", "":
			n = float64(facts.InputTokens)
		}
		return n > asFloat(when["gt"])
	}
	return false
}

func fieldValue(field string, facts Facts) string {
	switch field {
	case "identity.team":
		return facts.Team
	case "identity.organization":
		return facts.Organization
	case "identity.project":
		return facts.Project
	case "identity.key":
		return facts.Key
	case "identity.tags":
		return strings.Join(facts.Tags, ",")
	case "request.text":
		return facts.Text
	default:
		return ""
	}
}

func keywordHit(text string, class map[string]any) bool {
	for _, w := range asSlice(class["keywords"]) {
		if word := strings.ToLower(asString(w)); word != "" && strings.Contains(text, word) {
			return true
		}
	}
	return false
}

func regexHit(text string, class map[string]any) bool {
	for _, p := range asSlice(class["patterns"]) {
		re, err := regexp.Compile(asString(p))
		if err == nil && re.MatchString(text) {
			return true
		}
	}
	return false
}

// Breakers tracks circuit state and latency in memory for one process.
type Breakers struct {
	mu    sync.Mutex
	state map[string]*breaker
}

type breaker struct {
	failures int
	openTill time.Time
	ewma     float64
	inflight int
}

func NewBreakers() *Breakers { return &Breakers{state: map[string]*breaker{}} }

func (b *Breakers) get(name string) *breaker {
	br := b.state[name]
	if br == nil {
		br = &breaker{}
		b.state[name] = br
	}
	return br
}

func (b *Breakers) Allow(name string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	br := b.get(name)
	if br.openTill.IsZero() || time.Now().After(br.openTill) {
		return true
	}
	return false
}

func (b *Breakers) LatencyOnly(name string, ms float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	br := b.get(name)
	if ms > 0 {
		if br.ewma == 0 {
			br.ewma = ms
		} else {
			br.ewma = br.ewma*0.8 + ms*0.2
		}
	}
}

func (b *Breakers) Note(name string, ms float64, ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	br := b.get(name)
	if ms > 0 {
		if br.ewma == 0 {
			br.ewma = ms
		} else {
			br.ewma = br.ewma*0.8 + ms*0.2
		}
	}
	if ok {
		br.failures = 0
		br.openTill = time.Time{}
		return
	}
	br.failures++
	if br.failures >= 5 {
		br.openTill = time.Now().Add(30 * time.Second)
	}
}

func (b *Breakers) Latency(name string) float64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.get(name).ewma
}

func (b *Breakers) AddInFlight(name string, delta int) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	br := b.get(name)
	br.inflight += delta
	if br.inflight < 0 {
		br.inflight = 0
	}
	return br.inflight
}

func (b *Breakers) InFlight(name string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.get(name).inflight
}

func (b *Breakers) Snapshot(name string) (state string, failures int, openTill time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	br := b.get(name)
	state = "closed"
	if !br.openTill.IsZero() && time.Now().Before(br.openTill) {
		state = "open"
	}
	return state, br.failures, br.openTill
}
