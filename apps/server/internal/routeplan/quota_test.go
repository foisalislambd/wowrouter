package routeplan

import (
	"testing"
	"time"
)

func TestOrderWindowsDegradesWithoutData(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	for _, strategy := range []string{StrategyHeadroom, StrategyResetWindow, StrategyQuotaShare} {
		got, err := OrderWindows(strategy, 3, nil, now)
		if err != nil || !sameInts(got, []int{0, 1, 2}) {
			t.Fatalf("%s = %v err=%v", strategy, got, err)
		}
	}
}

func TestFillFirstSkipsCooldown(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	got, err := OrderWindows(StrategyFillFirst, 3, []Window{
		{CooldownUntil: now.Unix() + 30},
		{Remaining: 10, Limit: 10},
		{Remaining: -1},
	}, now)
	if err != nil || !sameInts(got, []int{1, 2, 0}) {
		t.Fatalf("fill-first = %v err=%v", got, err)
	}
}

func TestHeadroomPrefersMoreRemaining(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	got, err := OrderWindows(StrategyHeadroom, 3, []Window{
		{Remaining: 1, Limit: 10},
		{Remaining: 9, Limit: 10},
		{Remaining: 5, Limit: 10},
	}, now)
	if err != nil || got[0] != 1 {
		t.Fatalf("headroom = %v err=%v", got, err)
	}
}

func TestResetWindowPrefersSoonerReset(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	got, err := OrderWindows(StrategyResetWindow, 3, []Window{
		{ResetUnix: now.Unix() + 500},
		{ResetUnix: now.Unix() + 10},
		{},
	}, now)
	if err != nil || !sameInts(got, []int{1, 0, 2}) {
		t.Fatalf("reset = %v err=%v", got, err)
	}
}

func TestQuotaShareDeprioritizesSpentSlice(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	got, err := OrderWindows(StrategyQuotaShare, 2, []Window{
		{Share: 5, Used: 5, Remaining: 20},
		{Share: 5, Used: 1, Remaining: 20},
	}, now)
	if err != nil || !sameInts(got, []int{1, 0}) {
		t.Fatalf("share = %v err=%v", got, err)
	}
}
