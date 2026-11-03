// Package quota reads rate-limit headers providers actually send.
package quota

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Snapshot is a local note of one upstream limit. Remaining -1 means unknown.
type Snapshot struct {
	Remaining     int
	Limit         int
	ResetUnix     int64
	CooldownUntil int64
	Known         bool
}

// Parse reads common OpenAI and Anthropic rate-limit headers.
// A 429 with Retry-After sets a cooldown even when the other headers are absent.
func Parse(status int, header http.Header, now time.Time) Snapshot {
	if header == nil {
		header = http.Header{}
	}
	var snap Snapshot
	snap.Remaining = -1
	if n, ok := firstInt(header, "x-ratelimit-remaining-requests", "anthropic-ratelimit-requests-remaining", "x-ratelimit-remaining"); ok {
		snap.Remaining = n
		snap.Known = true
	}
	if n, ok := firstInt(header, "x-ratelimit-limit-requests", "anthropic-ratelimit-requests-limit", "x-ratelimit-limit"); ok {
		snap.Limit = n
		snap.Known = true
	}
	if raw := firstText(header, "x-ratelimit-reset-requests", "anthropic-ratelimit-requests-reset", "x-ratelimit-reset"); raw != "" {
		if unix := parseReset(raw, now); unix > 0 {
			snap.ResetUnix = unix
			snap.Known = true
		}
	}
	if status == http.StatusTooManyRequests {
		snap.Known = true
		if snap.Remaining < 0 {
			snap.Remaining = 0
		}
		wait := retryAfter(header.Get("Retry-After"), now)
		if wait == 0 {
			wait = now.Add(30 * time.Second).Unix()
		}
		snap.CooldownUntil = wait
		if snap.ResetUnix == 0 {
			snap.ResetUnix = wait
		}
	}
	return snap
}

func firstInt(header http.Header, keys ...string) (int, bool) {
	raw := firstText(header, keys...)
	if raw == "" {
		return 0, false
	}
	raw = strings.TrimSpace(strings.Split(raw, ";")[0])
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func firstText(header http.Header, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(header.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func parseReset(raw string, now time.Time) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.Unix()
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return now.Add(d).Unix()
	}
	if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
		if n > 1_000_000_000 {
			return n
		}
		return now.Add(time.Duration(n) * time.Second).Unix()
	}
	return 0
}

func retryAfter(raw string, now time.Time) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
		return now.Add(time.Duration(n) * time.Second).Unix()
	}
	if t, err := http.ParseTime(raw); err == nil {
		return t.Unix()
	}
	return 0
}
