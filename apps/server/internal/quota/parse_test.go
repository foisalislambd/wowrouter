package quota

import (
	"net/http"
	"testing"
	"time"
)

func TestParseOpenAIHeaders(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	header := http.Header{}
	header.Set("x-ratelimit-remaining-requests", "8")
	header.Set("x-ratelimit-limit-requests", "10")
	header.Set("x-ratelimit-reset-requests", "30s")
	snap := Parse(200, header, now)
	if !snap.Known || snap.Remaining != 8 || snap.Limit != 10 || snap.ResetUnix != now.Add(30*time.Second).Unix() {
		t.Fatalf("snap = %+v", snap)
	}
}

func TestParse429RetryAfter(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	header := http.Header{}
	header.Set("Retry-After", "12")
	snap := Parse(http.StatusTooManyRequests, header, now)
	if snap.Remaining != 0 || snap.CooldownUntil != now.Add(12*time.Second).Unix() {
		t.Fatalf("snap = %+v", snap)
	}
}

func TestParseAnthropicReset(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	header := http.Header{}
	header.Set("anthropic-ratelimit-requests-remaining", "2")
	header.Set("anthropic-ratelimit-requests-reset", "2026-11-03T12:05:00Z")
	snap := Parse(200, header, now)
	if snap.Remaining != 2 || snap.ResetUnix != time.Date(2026, 11, 3, 12, 5, 0, 0, time.UTC).Unix() {
		t.Fatalf("snap = %+v", snap)
	}
}
