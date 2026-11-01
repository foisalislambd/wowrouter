package main

import (
	"testing"
	"time"
)

func TestPercentileNearestRank(t *testing.T) {
	sorted := make([]time.Duration, 100)
	for i := range sorted {
		sorted[i] = time.Duration(i+1) * time.Millisecond
	}
	if got := percentile(sorted, 0.50); got != 50*time.Millisecond {
		t.Fatalf("p50 = %s, want 50ms", got)
	}
	if got := percentile(sorted, 0.99); got != 99*time.Millisecond {
		t.Fatalf("p99 = %s, want 99ms", got)
	}
	if got := percentile(nil, 0.99); got != 0 {
		t.Fatalf("empty p99 = %s, want 0", got)
	}
	if got := percentile(sorted[:1], 0.99); got != time.Millisecond {
		t.Fatalf("single p99 = %s, want 1ms", got)
	}
}

func TestMedian(t *testing.T) {
	if got := medianInt64([]int64{3, 1, 2}); got != 2 {
		t.Fatalf("median int = %d", got)
	}
	if got := medianFloat([]float64{1, 2, 3, 4}); got != 2.5 {
		t.Fatalf("median float = %v", got)
	}
	if got := medianDuration([]time.Duration{3 * time.Millisecond, time.Millisecond}); got != 2*time.Millisecond {
		t.Fatalf("median duration = %s", got)
	}
}

func TestPassesAndDirectClean(t *testing.T) {
	if !passes(995, 1000, 5*time.Millisecond) {
		t.Fatal("995/1000 at 5ms should pass")
	}
	if passes(994, 1000, time.Millisecond) {
		t.Fatal("994/1000 should fail the success rule")
	}
	if passes(1000, 1000, 5*time.Millisecond+time.Microsecond) {
		t.Fatal("p99 overhead above 5ms should fail")
	}
	if passes(1, 0, 0) {
		t.Fatal("zero offered should fail")
	}
	if !directClean(1000, 1000, directP99Bound) {
		t.Fatal("direct p99 at the bound should be clean")
	}
	if directClean(1000, 1000, directP99Bound+time.Microsecond) {
		t.Fatal("direct p99 above the bound should not be clean")
	}
}
