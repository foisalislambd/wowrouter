// Package routeplan orders chat targets. The rules are local to WowRouter:
// a combo picks an order, and auto ranks models you have already turned on.
package routeplan

import (
	"sort"
	"strings"
)

const (
	StrategyPriority   = "priority"
	StrategyRoundRobin = "round-robin"
	StrategyWeighted   = "weighted"
	StrategyCost       = "cost"
	StrategyLeastUsed      = "least-used"
	StrategyFillFirst      = "fill-first"
	StrategyHeadroom       = "headroom"
	StrategyResetWindow    = "reset-window"
	StrategyQuotaWeighted  = "quota-weighted"
	StrategyQuotaShare     = "quota-share"
	StrategyDirect         = "direct"
)

// Window is what we know about one target's quota. Remaining -1 means the provider did not say.
type Window struct {
	Remaining     int
	Limit         int
	ResetUnix     int64
	CooldownUntil int64
	Used          int
	Share         int
}

// Candidate is one chat model the ranker can see. Prices are USD per million tokens.
type Candidate struct {
	ID           string
	Provider     string
	DisplayName  string
	Reasoning    bool
	Context      int
	InputPrice   float64
	OutputPrice  float64
	Requests     int
	Errors       int
	AvgLatencyMS int
}

// Filter narrows a model list. Zero values mean "no limit".
type Filter struct {
	Query      string
	Kind       string
	MinContext int
	Reasoning  *bool
}

// BlendedPrice weights output higher than input, which matches typical chat traffic.
func BlendedPrice(input, output float64) float64 {
	return input*0.25 + output*0.75
}

// NormalizeStrategy accepts the combo strategies the panel offers.
func NormalizeStrategy(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", StrategyPriority:
		return StrategyPriority, nil
	case StrategyRoundRobin, StrategyWeighted, StrategyCost, StrategyLeastUsed,
		StrategyFillFirst, StrategyHeadroom, StrategyResetWindow, StrategyQuotaWeighted, StrategyQuotaShare:
		return strings.ToLower(strings.TrimSpace(value)), nil
	default:
		return "", errStrategy
	}
}

// AutoProfile reports which auto preset a public model id names.
func AutoProfile(model string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "auto", "auto/balanced":
		return "balanced", true
	case "auto/cheap":
		return "cheap", true
	case "auto/fast":
		return "fast", true
	case "auto/coding":
		return "coding", true
	default:
		return "", false
	}
}

// AutoStrategy is the value returned on X-WowRouter-Strategy.
func AutoStrategy(profile string) string {
	if profile == "" || profile == "balanced" {
		return "auto"
	}
	return "auto/" + profile
}

// Rank orders candidates for one auto profile. Lower internal score is better.
// The slice is copied. An empty profile uses the balanced preset.
func Rank(profile string, items []Candidate) []Candidate {
	if len(items) == 0 {
		return []Candidate{}
	}
	profile = strings.ToLower(strings.TrimSpace(profile))
	if profile == "" {
		profile = "balanced"
	}
	out := append([]Candidate(nil), items...)
	cost := make([]float64, len(out))
	latency := make([]float64, len(out))
	errs := make([]float64, len(out))
	ctx := make([]float64, len(out))
	for i, item := range out {
		cost[i] = BlendedPrice(item.InputPrice, item.OutputPrice)
		if item.AvgLatencyMS <= 0 {
			latency[i] = 1500
		} else {
			latency[i] = float64(item.AvgLatencyMS)
		}
		if item.Requests <= 0 {
			errs[i] = 0.05
		} else {
			errs[i] = float64(item.Errors) / float64(item.Requests)
		}
		ctx[i] = float64(item.Context)
	}
	costN := normalize(cost)
	latN := normalize(latency)
	errN := normalize(errs)
	ctxN := normalize(ctx)
	type scored struct {
		item  Candidate
		score float64
	}
	ranked := make([]scored, len(out))
	for i, item := range out {
		reason := 0.0
		if item.Reasoning {
			reason = 1
		}
		value := 0.0
		switch profile {
		case "cheap":
			value = 0.85*costN[i] + 0.10*errN[i] + 0.05*latN[i]
		case "fast":
			value = 0.75*latN[i] + 0.15*errN[i] + 0.10*costN[i]
		case "coding":
			value = 0.40*(1-reason) + 0.30*(1-ctxN[i]) + 0.15*errN[i] + 0.15*costN[i]
		default:
			value = 0.40*costN[i] + 0.25*latN[i] + 0.25*errN[i] + 0.10*(1-ctxN[i])
		}
		ranked[i] = scored{item: item, score: value}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score == ranked[j].score {
			return ranked[i].item.ID < ranked[j].item.ID
		}
		return ranked[i].score < ranked[j].score
	})
	for i := range ranked {
		out[i] = ranked[i].item
	}
	return out
}

// Order returns a permutation of 0..n-1 for a saved combo.
// cursor is the round-robin start. roll is an index into the weight sum, used by weighted.
func Order(strategy string, n int, weights []int, costs []float64, counts []int, cursor, roll int) ([]int, error) {
	if n <= 0 {
		return nil, nil
	}
	name, err := NormalizeStrategy(strategy)
	if err != nil {
		return nil, err
	}
	switch name {
	case StrategyRoundRobin:
		return rotate(n, cursor), nil
	case StrategyWeighted:
		return rotate(n, WeightedIndex(weights, roll)), nil
	case StrategyCost:
		return sortBy(n, func(i, j int) bool {
			ci, cj := costAt(costs, i), costAt(costs, j)
			if ci == cj {
				return i < j
			}
			return ci < cj
		}), nil
	case StrategyLeastUsed:
		return sortBy(n, func(i, j int) bool {
			ci, cj := countAt(counts, i), countAt(counts, j)
			if ci == cj {
				return i < j
			}
			return ci < cj
		}), nil
	default:
		return rotate(n, 0), nil
	}
}

// WeightedIndex picks a start position. Weights below 1 are treated as 1.
func WeightedIndex(weights []int, roll int) int {
	if len(weights) == 0 {
		return 0
	}
	sum := 0
	clean := make([]int, len(weights))
	for i, weight := range weights {
		if weight < 1 {
			weight = 1
		}
		clean[i] = weight
		sum += weight
	}
	if sum <= 0 {
		return 0
	}
	roll %= sum
	if roll < 0 {
		roll += sum
	}
	acc := 0
	for i, weight := range clean {
		acc += weight
		if roll < acc {
			return i
		}
	}
	return len(clean) - 1
}

func rotate(n, start int) []int {
	if n <= 0 {
		return nil
	}
	start %= n
	if start < 0 {
		start += n
	}
	out := make([]int, n)
	for i := 0; i < n; i++ {
		out[i] = (start + i) % n
	}
	return out
}

func sortBy(n int, less func(i, j int) bool) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	sort.SliceStable(out, func(a, b int) bool { return less(out[a], out[b]) })
	return out
}

func costAt(costs []float64, i int) float64 {
	if i < 0 || i >= len(costs) {
		return 0
	}
	return costs[i]
}

func countAt(counts []int, i int) int {
	if i < 0 || i >= len(counts) {
		return 0
	}
	return counts[i]
}

func normalize(values []float64) []float64 {
	if len(values) == 0 {
		return nil
	}
	min, max := values[0], values[0]
	for _, value := range values[1:] {
		if value < min {
			min = value
		}
		if value > max {
			max = value
		}
	}
	out := make([]float64, len(values))
	span := max - min
	for i, value := range values {
		if span == 0 {
			out[i] = 0
			continue
		}
		out[i] = (value - min) / span
	}
	return out
}

type strategyError string

func (e strategyError) Error() string { return string(e) }

const errStrategy strategyError = "strategy must be priority, round-robin, weighted, cost, least-used, fill-first, headroom, reset-window, quota-weighted, or quota-share"
