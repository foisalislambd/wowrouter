package main

import (
	"math"
	"sort"
	"time"
)

// percentile returns the nearest-rank percentile of a sorted slice.
// rank = ceil(p*n) - 1. p is in (0, 1]. An empty slice returns 0.
func percentile(sorted []time.Duration, p float64) time.Duration {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if p <= 0 {
		return sorted[0]
	}
	if p > 1 {
		p = 1
	}
	rank := int(math.Ceil(p*float64(n))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= n {
		rank = n - 1
	}
	return sorted[rank]
}

func medianDuration(values []time.Duration) time.Duration {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]time.Duration(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

func medianInt64(values []int64) int64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

func medianFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

// passes is the saturation rule for one open-loop step.
// A step passes when at least 99.5% of offered requests succeed and the p99
// overhead is at most 5ms. offered must be the measurement-window count.
func passes(success, offered int, overheadP99 time.Duration) bool {
	if offered <= 0 || success < 0 {
		return false
	}
	if int64(success)*1000 < int64(offered)*995 {
		return false
	}
	return overheadP99 <= 5*time.Millisecond
}

// directP99Bound is the clean-baseline limit for a direct run on this harness.
// A dedicated mock machine can use a 1ms bound.
// Here the mock shares the machine with the generator, and a quiet direct run
// already comes back around 1–2ms, so a 1ms rule would reject every step.
// 5ms still marks a baseline that is too noisy to subtract.
const directP99Bound = 5 * time.Millisecond

// directClean reports whether the direct run is a usable baseline:
// 99.5% success and p99 within directP99Bound of an instant upstream.
func directClean(success, offered int, p99 time.Duration) bool {
	if offered <= 0 || success < 0 {
		return false
	}
	if int64(success)*1000 < int64(offered)*995 {
		return false
	}
	return p99 <= directP99Bound
}
