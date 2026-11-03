package routeplan

import "time"

// OrderWindows orders combo targets using quota hints.
// When every window is unknown, the result matches priority order.
func OrderWindows(strategy string, n int, windows []Window, now time.Time) ([]int, error) {
	name, err := NormalizeStrategy(strategy)
	if err != nil {
		return nil, err
	}
	if n <= 0 {
		return nil, nil
	}
	switch name {
	case StrategyFillFirst:
		return partition(n, func(i int) bool { return !blocked(windowAt(windows, i), now) }), nil
	case StrategyHeadroom:
		if !anyKnown(windows, n) {
			return rotate(n, 0), nil
		}
		return sortBy(n, func(i, j int) bool {
			hi, hj := headroom(windowAt(windows, i)), headroom(windowAt(windows, j))
			if hi == hj {
				return i < j
			}
			return hi > hj
		}), nil
	case StrategyResetWindow:
		if !anyReset(windows, n) {
			return rotate(n, 0), nil
		}
		return sortBy(n, func(i, j int) bool {
			ri, rj := resetAt(windowAt(windows, i)), resetAt(windowAt(windows, j))
			if ri == rj {
				return i < j
			}
			if ri == 0 {
				return false
			}
			if rj == 0 {
				return true
			}
			return ri < rj
		}), nil
	case StrategyQuotaWeighted:
		weights := make([]int, n)
		open := 0
		for i := 0; i < n; i++ {
			w := windowAt(windows, i)
			if blocked(w, now) {
				weights[i] = 0
				continue
			}
			if w.Remaining < 0 {
				weights[i] = 1
			} else {
				weights[i] = w.Remaining
			}
			if weights[i] > 0 {
				open++
			}
		}
		if open == 0 {
			return rotate(n, 0), nil
		}
		return weightedThenRest(weights, n), nil
	case StrategyQuotaShare:
		return partition(n, func(i int) bool {
			w := windowAt(windows, i)
			if w.Share <= 0 {
				return true
			}
			return w.Used < w.Share && !blocked(w, now)
		}), nil
	default:
		return rotate(n, 0), nil
	}
}

func windowAt(windows []Window, i int) Window {
	if i < 0 || i >= len(windows) {
		return Window{Remaining: -1}
	}
	return windows[i]
}

func blocked(w Window, now time.Time) bool {
	if w.CooldownUntil > now.Unix() {
		return true
	}
	return w.Remaining == 0
}

func anyKnown(windows []Window, n int) bool {
	for i := 0; i < n; i++ {
		w := windowAt(windows, i)
		if w.Remaining >= 0 || w.Limit > 0 {
			return true
		}
	}
	return false
}

func anyReset(windows []Window, n int) bool {
	for i := 0; i < n; i++ {
		if resetAt(windowAt(windows, i)) > 0 {
			return true
		}
	}
	return false
}

func resetAt(w Window) int64 {
	if w.CooldownUntil > 0 {
		return w.CooldownUntil
	}
	return w.ResetUnix
}

func headroom(w Window) float64 {
	if w.Remaining < 0 && w.Limit <= 0 {
		return 0.5
	}
	if w.Limit > 0 && w.Remaining >= 0 {
		return float64(w.Remaining) / float64(w.Limit)
	}
	if w.Remaining >= 0 {
		return float64(w.Remaining)
	}
	return 0.5
}

func partition(n int, keep func(int) bool) []int {
	var first, rest []int
	for i := 0; i < n; i++ {
		if keep(i) {
			first = append(first, i)
		} else {
			rest = append(rest, i)
		}
	}
	return append(first, rest...)
}

func weightedThenRest(weights []int, n int) []int {
	sum := 0
	for _, weight := range weights {
		if weight > 0 {
			sum += weight
		}
	}
	start := 0
	if sum > 0 {
		roll := sum / 2
		acc := 0
		for i, weight := range weights {
			if weight <= 0 {
				continue
			}
			acc += weight
			if roll < acc {
				start = i
				break
			}
		}
	}
	seen := map[int]bool{}
	out := make([]int, 0, n)
	for _, index := range rotate(n, start) {
		if weights[index] > 0 {
			out = append(out, index)
			seen[index] = true
		}
	}
	for i := 0; i < n; i++ {
		if !seen[i] {
			out = append(out, i)
		}
	}
	return out
}
