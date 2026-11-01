// Package combo orders provider targets the way a routing combo asks.
// The strategies are implemented here. They do not call a provider.
package combo

import (
	"hash/fnv"
	"math"
	"sort"
	"strings"
	"time"
)

// Candidate is one model a combo can send to.
type Candidate struct {
	ID           string
	Provider     string
	Weight       float64
	Cost         float64
	Quota        float64
	Reset        time.Time
	InFlight     int
	Latency      float64
	Context      int
	LastGood     bool
	Healthy      bool
	Subscription bool
	Quality      float64
}

// Request is what the caller knows about this turn.
type Request struct {
	Now           time.Time
	Session       string
	ContextTokens int
	Rand          float64
	Cursor        int
}

// Result is the attempt plan. Failover tries Attempts in order.
// Fanout calls every attempt. Pipeline feeds each output into the next.
type Result struct {
	Attempts []string
	Mode     string
}

// Strategies is the combo vocabulary, in the order the panel shows them.
func Strategies() []string {
	return []string{
		"priority", "fill-first", "weighted", "round-robin", "p2c", "least-used",
		"random", "strict-random", "cost-optimized", "headroom", "quota-weighted",
		"reset-window", "reset-aware", "context-relay", "context-optimized",
		"cache-optimized", "lkgp", "auto", "fusion", "pipeline",
	}
}

// AutoModels are the zero-config model ids.
func AutoModels() []string {
	return []string{
		"auto", "auto/fast", "auto/cheap", "auto/coding", "auto/subscription",
		"auto/thrifty", "auto/offline", "auto/smart", "auto/lkgp", "auto/chaos",
	}
}

// KnownModel reports whether model is an auto id or a combo:name reference.
func KnownModel(model string) bool {
	if strings.HasPrefix(model, "combo:") && len(model) > len("combo:") {
		return true
	}
	for _, name := range AutoModels() {
		if model == name {
			return true
		}
	}
	return false
}

// Order ranks candidates for strategy. Unknown strategies fall back to priority.
func Order(strategy string, cands []Candidate, req Request) Result {
	alive := make([]Candidate, 0, len(cands))
	for _, c := range cands {
		if c.Healthy && c.ID != "" {
			alive = append(alive, c)
		}
	}
	if len(alive) == 0 {
		return Result{Mode: "failover"}
	}
	switch strategy {
	case "fill-first":
		sort.SliceStable(alive, func(i, j int) bool { return alive[i].Quota < alive[j].Quota })
		return failover(alive)
	case "weighted":
		return failover(weightedOrder(alive, req.Rand))
	case "round-robin":
		n := len(alive)
		start := req.Cursor % n
		if start < 0 {
			start = 0
		}
		out := append(alive[start:], alive[:start]...)
		return failover(out)
	case "p2c":
		if len(alive) == 1 {
			return failover(alive)
		}
		a := pickIndex(len(alive), req.Rand)
		b := pickIndex(len(alive), frac(req.Rand*7.3))
		if b == a {
			b = (a + 1) % len(alive)
		}
		first, second := alive[a], alive[b]
		if second.InFlight < first.InFlight || (second.InFlight == first.InFlight && second.Latency < first.Latency) {
			first, second = second, first
		}
		rest := without(alive, first.ID, second.ID)
		return failover(append([]Candidate{first, second}, rest...))
	case "least-used":
		sort.SliceStable(alive, func(i, j int) bool {
			if alive[i].InFlight != alive[j].InFlight {
				return alive[i].InFlight < alive[j].InFlight
			}
			return alive[i].Latency < alive[j].Latency
		})
		return failover(alive)
	case "random":
		return failover(shuffle(alive, req.Rand))
	case "strict-random":
		seq := make([]Candidate, len(alive))
		for i := range seq {
			seq[i] = alive[pickIndex(len(alive), frac(req.Rand+float64(i)*0.173))]
		}
		return Result{Attempts: ids(seq), Mode: "failover"}
	case "cost-optimized":
		sort.SliceStable(alive, func(i, j int) bool { return alive[i].Cost < alive[j].Cost })
		return failover(alive)
	case "headroom", "auto/offline":
		sort.SliceStable(alive, func(i, j int) bool { return alive[i].Quota > alive[j].Quota })
		return failover(alive)
	case "quota-weighted":
		if pinned := pin(alive); req.Session != "" && pinned != nil {
			return failover(append([]Candidate{*pinned}, without(alive, pinned.ID)...))
		}
		return failover(weightedBy(alive, req.Rand, func(c Candidate) float64 {
			return math.Max(c.Quota, 0.01) / float64(c.InFlight+1)
		}))
	case "reset-window", "reset-aware":
		sort.SliceStable(alive, func(i, j int) bool { return sooner(alive[i].Reset, alive[j].Reset, req.Now) })
		return failover(alive)
	case "context-relay":
		if pinned := pin(alive); pinned != nil {
			return failover(append([]Candidate{*pinned}, without(alive, pinned.ID)...))
		}
		return failover(alive)
	case "context-optimized":
		need := req.ContextTokens
		sort.SliceStable(alive, func(i, j int) bool {
			ai, aj := fit(alive[i].Context, need), fit(alive[j].Context, need)
			if ai != aj {
				return ai > aj
			}
			return alive[i].Context > alive[j].Context
		})
		return failover(alive)
	case "cache-optimized":
		key := req.Session
		if key == "" {
			key = "prefix"
		}
		h := int(fnv.New32a().Sum([]byte(key))[0]) % 251
		// fnv of string
		sum := fnv.New32a()
		_, _ = sum.Write([]byte(key))
		idx := int(sum.Sum32() % uint32(len(alive)))
		_ = h
		first := alive[idx]
		return failover(append([]Candidate{first}, without(alive, first.ID)...))
	case "lkgp", "auto/lkgp", "auto":
		if pinned := pin(alive); pinned != nil {
			return failover(append([]Candidate{*pinned}, score(without(alive, pinned.ID), req)...))
		}
		return failover(score(alive, req))
	case "auto/fast":
		sort.SliceStable(alive, func(i, j int) bool { return alive[i].Latency < alive[j].Latency })
		return failover(alive)
	case "auto/cheap":
		sort.SliceStable(alive, func(i, j int) bool { return alive[i].Cost < alive[j].Cost })
		return failover(alive)
	case "auto/coding":
		sort.SliceStable(alive, func(i, j int) bool { return alive[i].Quality > alive[j].Quality })
		return failover(alive)
	case "auto/subscription":
		var sub []Candidate
		for _, c := range alive {
			if c.Subscription && c.Quota > 0 {
				sub = append(sub, c)
			}
		}
		sort.SliceStable(sub, func(i, j int) bool { return sub[i].Quota > sub[j].Quota })
		return failover(sub)
	case "auto/thrifty":
		var sub, paid []Candidate
		for _, c := range alive {
			if c.Subscription && c.Quota > 0 {
				sub = append(sub, c)
			} else {
				paid = append(paid, c)
			}
		}
		sort.SliceStable(paid, func(i, j int) bool { return paid[i].Cost < paid[j].Cost })
		return failover(append(sub, paid...))
	case "auto/smart":
		ranked := score(alive, req)
		if len(ranked) > 1 && req.Rand < 0.10 {
			// Ten percent of turns try the second-best candidate first.
			ranked[0], ranked[1] = ranked[1], ranked[0]
		}
		return failover(ranked)
	case "auto/chaos", "fusion":
		panel := shuffle(alive, req.Rand)
		if len(panel) > 5 {
			panel = panel[:5]
		}
		return Result{Attempts: ids(panel), Mode: "fanout"}
	case "pipeline":
		return Result{Attempts: ids(alive), Mode: "pipeline"}
	default:
		return failover(alive)
	}
}

func failover(c []Candidate) Result { return Result{Attempts: ids(c), Mode: "failover"} }

func ids(c []Candidate) []string {
	out := make([]string, len(c))
	for i := range c {
		out[i] = c[i].ID
	}
	return out
}

func pin(c []Candidate) *Candidate {
	for i := range c {
		if c[i].LastGood {
			return &c[i]
		}
	}
	return nil
}

func without(c []Candidate, ids ...string) []Candidate {
	drop := map[string]bool{}
	for _, id := range ids {
		drop[id] = true
	}
	var out []Candidate
	for _, item := range c {
		if !drop[item.ID] {
			out = append(out, item)
		}
	}
	return out
}

func weightedOrder(c []Candidate, r float64) []Candidate {
	if len(c) == 0 {
		return nil
	}
	first := weightedPick(c, r)
	return append([]Candidate{first}, without(c, first.ID)...)
}

func weightedBy(c []Candidate, r float64, w func(Candidate) float64) []Candidate {
	type row struct {
		c Candidate
		w float64
	}
	rows := make([]row, len(c))
	for i := range c {
		rows[i] = row{c: c[i], w: w(c[i])}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].w > rows[j].w })
	ordered := make([]Candidate, len(rows))
	for i := range rows {
		ordered[i] = rows[i].c
	}
	if len(ordered) == 0 {
		return nil
	}
	pick := weightedPick(ordered, r)
	// Rebuild weights on the original function by copying Weight.
	return append([]Candidate{pick}, without(ordered, pick.ID)...)
}

func weightedPick(c []Candidate, r float64) Candidate {
	total := 0.0
	for _, item := range c {
		w := item.Weight
		if w <= 0 {
			w = 1
		}
		total += w
	}
	mark := frac(r) * total
	acc := 0.0
	for _, item := range c {
		w := item.Weight
		if w <= 0 {
			w = 1
		}
		acc += w
		if mark <= acc {
			return item
		}
	}
	return c[len(c)-1]
}

func shuffle(c []Candidate, r float64) []Candidate {
	out := append([]Candidate(nil), c...)
	for i := len(out) - 1; i > 0; i-- {
		j := pickIndex(i+1, frac(r+float64(i)*0.131))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func score(c []Candidate, req Request) []Candidate {
	out := append([]Candidate(nil), c...)
	sort.SliceStable(out, func(i, j int) bool { return factors(out[i], req) > factors(out[j], req) })
	return out
}

// factors is a stand-in for a 16-factor score: health is already filtered,
// then quota, cost, latency, quality, load, context fit, subscription, and recency.
func factors(c Candidate, req Request) float64 {
	quota := clamp(c.Quota, 0, 1)
	cost := 1 / (1 + math.Max(c.Cost, 0))
	lat := 1 / (1 + math.Max(c.Latency, 0)/1000)
	load := 1 / float64(c.InFlight+1)
	fit := fit(c.Context, req.ContextTokens)
	sub := 0.0
	if c.Subscription {
		sub = 0.25
	}
	good := 0.0
	if c.LastGood {
		good = 0.5
	}
	reset := 0.0
	if !c.Reset.IsZero() && !req.Now.IsZero() && c.Reset.After(req.Now) && c.Reset.Sub(req.Now) < 15*time.Minute {
		reset = 0.15
	}
	return quota + cost + lat + clamp(c.Quality, 0, 1) + load + fit + sub + good + reset
}

func fit(context, need int) float64 {
	if context <= 0 {
		return 0.2
	}
	if need <= 0 || context >= need {
		return 1
	}
	return float64(context) / float64(need)
}

func sooner(a, b, now time.Time) bool {
	if a.IsZero() && b.IsZero() {
		return false
	}
	if a.IsZero() {
		return false
	}
	if b.IsZero() {
		return true
	}
	return a.Before(b)
}

func pickIndex(n int, r float64) int {
	if n <= 1 {
		return 0
	}
	i := int(frac(r) * float64(n))
	if i >= n {
		return n - 1
	}
	return i
}

func frac(r float64) float64 {
	if math.IsNaN(r) || r < 0 {
		return 0
	}
	return r - math.Floor(r)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
