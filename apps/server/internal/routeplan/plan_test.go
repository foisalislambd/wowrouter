package routeplan

import "testing"

func TestRankCheapPrefersLowerPrice(t *testing.T) {
	ranked := Rank("cheap", []Candidate{
		{ID: "b/expensive", InputPrice: 10, OutputPrice: 30},
		{ID: "a/free", InputPrice: 0, OutputPrice: 0},
		{ID: "c/mid", InputPrice: 1, OutputPrice: 2},
	})
	if len(ranked) != 3 || ranked[0].ID != "a/free" || ranked[1].ID != "c/mid" || ranked[2].ID != "b/expensive" {
		t.Fatalf("order = %+v", ids(ranked))
	}
}

func TestRankFastUsesMeasuredLatency(t *testing.T) {
	ranked := Rank("fast", []Candidate{
		{ID: "slow", AvgLatencyMS: 2000, InputPrice: 0, OutputPrice: 0},
		{ID: "quick", AvgLatencyMS: 80, InputPrice: 5, OutputPrice: 15},
		{ID: "unknown", AvgLatencyMS: 0, InputPrice: 0, OutputPrice: 0},
	})
	if ranked[0].ID != "quick" {
		t.Fatalf("first = %s (%v)", ranked[0].ID, ids(ranked))
	}
	if ranked[len(ranked)-1].ID == "quick" {
		t.Fatal("quick sorted last")
	}
}

func TestRankCodingPrefersReasoningAndContext(t *testing.T) {
	ranked := Rank("coding", []Candidate{
		{ID: "small", Context: 8000, InputPrice: 0, OutputPrice: 0},
		{ID: "reasoner", Reasoning: true, Context: 128000, InputPrice: 3, OutputPrice: 15},
	})
	if ranked[0].ID != "reasoner" {
		t.Fatalf("first = %s", ranked[0].ID)
	}
}

func TestRankIsStableWhenScoresMatch(t *testing.T) {
	ranked := Rank("balanced", []Candidate{
		{ID: "b", InputPrice: 1, OutputPrice: 1, Context: 1000},
		{ID: "a", InputPrice: 1, OutputPrice: 1, Context: 1000},
	})
	if ranked[0].ID != "a" || ranked[1].ID != "b" {
		t.Fatalf("order = %v", ids(ranked))
	}
}

func TestOrderStrategies(t *testing.T) {
	priority, err := Order(StrategyPriority, 3, nil, nil, nil, 0, 0)
	if err != nil || !sameInts(priority, []int{0, 1, 2}) {
		t.Fatalf("priority = %v err=%v", priority, err)
	}
	robin, err := Order(StrategyRoundRobin, 3, nil, nil, nil, 1, 0)
	if err != nil || !sameInts(robin, []int{1, 2, 0}) {
		t.Fatalf("robin = %v err=%v", robin, err)
	}
	weighted, err := Order(StrategyWeighted, 3, []int{1, 1, 5}, nil, nil, 0, 3)
	if err != nil || weighted[0] != 2 {
		t.Fatalf("weighted = %v err=%v", weighted, err)
	}
	cost, err := Order(StrategyCost, 3, nil, []float64{3, 0.1, 1}, nil, 0, 0)
	if err != nil || !sameInts(cost, []int{1, 2, 0}) {
		t.Fatalf("cost = %v err=%v", cost, err)
	}
	least, err := Order(StrategyLeastUsed, 3, nil, nil, []int{4, 4, 1}, 0, 0)
	if err != nil || least[0] != 2 {
		t.Fatalf("least = %v err=%v", least, err)
	}
	if _, err := Order("chaos", 2, nil, nil, nil, 0, 0); err == nil {
		t.Fatal("unknown strategy accepted")
	}
}

func TestWeightedIndex(t *testing.T) {
	if WeightedIndex([]int{1, 3}, 0) != 0 {
		t.Fatal("roll 0")
	}
	if WeightedIndex([]int{1, 3}, 1) != 1 {
		t.Fatal("roll 1")
	}
	if WeightedIndex([]int{0, 2}, 1) != 1 {
		t.Fatal("zero weight was not lifted")
	}
}

func TestAutoProfile(t *testing.T) {
	profile, ok := AutoProfile("auto")
	if !ok || profile != "balanced" || AutoStrategy(profile) != "auto" {
		t.Fatalf("auto = %s %v", profile, ok)
	}
	profile, ok = AutoProfile("auto/coding")
	if !ok || AutoStrategy(profile) != "auto/coding" {
		t.Fatalf("coding = %s", profile)
	}
	if _, ok := AutoProfile("openai/gpt-4o-mini"); ok {
		t.Fatal("concrete model looked like auto")
	}
}

func ids(items []Candidate) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = item.ID
	}
	return out
}

func sameInts(got, want []int) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
