package combo

import (
	"math/rand"
	"testing"
	"time"
)

func cands() []Candidate {
	return []Candidate{
		{ID: "a", Weight: 1, Cost: 3, Quota: 0.2, InFlight: 2, Latency: 400, Context: 8000, Healthy: true, Quality: 0.4},
		{ID: "b", Weight: 5, Cost: 1, Quota: 0.9, InFlight: 0, Latency: 100, Context: 128000, Healthy: true, Quality: 0.9, Subscription: true},
		{ID: "c", Weight: 1, Cost: 0.2, Quota: 0.1, InFlight: 4, Latency: 800, Context: 16000, Healthy: true, Quality: 0.2},
		{ID: "down", Healthy: false, Cost: 0},
	}
}

func TestPrioritySkipsUnhealthy(t *testing.T) {
	got := Order("priority", cands(), Request{})
	if len(got.Attempts) != 3 || got.Attempts[0] != "a" || got.Mode != "failover" {
		t.Fatalf("%+v", got)
	}
}

func TestFillFirstDrainsTheSmallestQuota(t *testing.T) {
	got := Order("fill-first", cands(), Request{})
	if got.Attempts[0] != "c" {
		t.Fatalf("%v", got.Attempts)
	}
}

func TestWeightedPrefersTheHeavyTarget(t *testing.T) {
	hits := map[string]int{}
	for i := 0; i < 400; i++ {
		got := Order("weighted", cands(), Request{Rand: rand.Float64()})
		hits[got.Attempts[0]]++
	}
	if hits["b"] <= hits["a"] || hits["b"] <= hits["c"] {
		t.Fatalf("weights: %v", hits)
	}
}

func TestRoundRobinCycles(t *testing.T) {
	var seq []string
	for i := 0; i < 3; i++ {
		got := Order("round-robin", cands(), Request{Cursor: i})
		seq = append(seq, got.Attempts[0])
	}
	if seq[0] != "a" || seq[1] != "b" || seq[2] != "c" {
		t.Fatalf("%v", seq)
	}
}

func TestLeastUsedAndCost(t *testing.T) {
	if Order("least-used", cands(), Request{}).Attempts[0] != "b" {
		t.Fatal("least-used")
	}
	if Order("cost-optimized", cands(), Request{}).Attempts[0] != "c" {
		t.Fatal("cost")
	}
	if Order("headroom", cands(), Request{}).Attempts[0] != "b" {
		t.Fatal("headroom")
	}
}

func TestP2CPicksTheQuieterOfTwo(t *testing.T) {
	got := Order("p2c", cands(), Request{Rand: 0.01})
	if len(got.Attempts) < 2 {
		t.Fatal(got.Attempts)
	}
}

func TestSubscriptionFailsClosed(t *testing.T) {
	got := Order("auto/subscription", cands(), Request{})
	if len(got.Attempts) != 1 || got.Attempts[0] != "b" {
		t.Fatalf("%v", got.Attempts)
	}
	none := []Candidate{{ID: "paid", Healthy: true, Cost: 1, Quota: 1}}
	if len(Order("auto/subscription", none, Request{}).Attempts) != 0 {
		t.Fatal("expected no billable fallback")
	}
}

func TestLKGPSticks(t *testing.T) {
	list := cands()
	list[2].LastGood = true
	if Order("lkgp", list, Request{}).Attempts[0] != "c" {
		t.Fatal("lkgp")
	}
	if Order("auto", list, Request{}).Attempts[0] != "c" {
		t.Fatal("auto")
	}
}

func TestFusionIsAPanel(t *testing.T) {
	got := Order("fusion", cands(), Request{Rand: 0.2})
	if got.Mode != "fanout" || len(got.Attempts) != 3 {
		t.Fatalf("%+v", got)
	}
	got = Order("pipeline", cands(), Request{})
	if got.Mode != "pipeline" || len(got.Attempts) != 3 {
		t.Fatalf("%+v", got)
	}
}

func TestResetAwarePrefersTheSoonerWindow(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	list := cands()
	list[0].Reset = now.Add(2 * time.Hour)
	list[1].Reset = now.Add(5 * time.Minute)
	list[2].Reset = now.Add(30 * time.Minute)
	if Order("reset-aware", list, Request{Now: now}).Attempts[0] != "b" {
		t.Fatal(Order("reset-aware", list, Request{Now: now}).Attempts)
	}
}

func TestContextOptimizedFits(t *testing.T) {
	got := Order("context-optimized", cands(), Request{ContextTokens: 100000})
	if got.Attempts[0] != "b" {
		t.Fatalf("%v", got.Attempts)
	}
}

func TestFastAndCoding(t *testing.T) {
	if Order("auto/fast", cands(), Request{}).Attempts[0] != "b" {
		t.Fatal("fast")
	}
	if Order("auto/coding", cands(), Request{}).Attempts[0] != "b" {
		t.Fatal("coding")
	}
	if Order("auto/cheap", cands(), Request{}).Attempts[0] != "c" {
		t.Fatal("cheap")
	}
}

func TestKnownModels(t *testing.T) {
	if !KnownModel("auto/thrifty") || !KnownModel("combo:daily") || KnownModel("gpt-4o") {
		t.Fatal("known")
	}
	if len(Strategies()) != 20 || len(AutoModels()) != 10 {
		t.Fatalf("strategies %d autos %d", len(Strategies()), len(AutoModels()))
	}
}
