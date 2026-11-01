package gateway

import (
	"fmt"
	"time"
)

type BudgetRef struct {
	Level  string
	Owner  string
	Name   string
	Unit   string
	Amount float64
	Period string
	Mode   string
	Alerts []float64
}

type LimitRef struct {
	Level  string
	Owner  string
	Name   string
	Unit   string
	Limit  int
	Window time.Duration
}

type Charge struct {
	USD    float64
	Tokens int
}

func BudgetsOf(level, owner string, spec map[string]any) []BudgetRef {
	policies := asMap(spec["policies"])
	raw := asMap(policies["budgets"])
	var out []BudgetRef
	for name, value := range raw {
		b := asMap(value)
		if b == nil {
			continue
		}
		period := asString(b["period"])
		if period == "" {
			period = "monthly"
		}
		var alerts []float64
		for _, a := range asSlice(b["alert_at"]) {
			alerts = append(alerts, asFloat(a))
		}
		mode := asString(b["mode"])
		if mode == "" {
			mode = "hard"
		}
		out = append(out, BudgetRef{
			Level: level, Owner: owner, Name: name,
			Unit: asString(b["unit"]), Amount: asFloat(b["amount"]), Period: period, Mode: mode, Alerts: alerts,
		})
	}
	return out
}

func LimitsOf(level, owner string, spec map[string]any) []LimitRef {
	policies := asMap(spec["policies"])
	raw := asMap(policies["limits"])
	var out []LimitRef
	for name, value := range raw {
		b := asMap(value)
		if b == nil {
			continue
		}
		window := parseDuration(asString(b["per"]))
		if window <= 0 {
			window = time.Minute
		}
		out = append(out, LimitRef{
			Level: level, Owner: owner, Name: name,
			Unit: asString(b["unit"]), Limit: int(asFloat(b["limit"])), Window: window,
		})
	}
	return out
}

func Bucket(level, owner, name, period string, now time.Time) string {
	return fmt.Sprintf("%s/%s/%s/%s", level, owner, name, PeriodStart(period, now).Format("2006-01-02"))
}

func PeriodStart(period string, now time.Time) time.Time {
	now = now.UTC()
	switch period {
	case "daily":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	case "weekly":
		off := int(now.Weekday()+6) % 7
		d := now.AddDate(0, 0, -off)
		return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)
	case "yearly":
		return time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	default:
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
}

func parseDuration(raw string) time.Duration {
	if raw == "" {
		return 0
	}
	if d, err := time.ParseDuration(raw); err == nil {
		return d
	}
	switch raw {
	case "1m", "minute":
		return time.Minute
	case "1h", "hour":
		return time.Hour
	case "1d", "day":
		return 24 * time.Hour
	default:
		return 0
	}
}

func PriceUSD(in, out float64, prompt, completion int) float64 {
	return (float64(prompt)*in + float64(completion)*out) / 1_000_000
}
