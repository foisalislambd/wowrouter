// Package metrics exposes a small Prometheus text endpoint.
package metrics

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

var (
	requests atomic.Int64
	errors   atomic.Int64
	inflight atomic.Int64
	latency  atomic.Int64
)

// Observe records one finished HTTP request.
func Observe(status int, d time.Duration) {
	requests.Add(1)
	if status >= 500 {
		errors.Add(1)
	}
	latency.Store(d.Microseconds())
}

// Begin marks an in-flight request. Call the returned function when it finishes.
func Begin() func() {
	inflight.Add(1)
	return func() { inflight.Add(-1) }
}

// Handler writes the current counters.
func Handler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP wowrouter_http_requests_total Completed HTTP requests.\n# TYPE wowrouter_http_requests_total counter\nwowrouter_http_requests_total %d\n", requests.Load())
	fmt.Fprintf(w, "# HELP wowrouter_http_errors_total HTTP 5xx responses.\n# TYPE wowrouter_http_errors_total counter\nwowrouter_http_errors_total %d\n", errors.Load())
	fmt.Fprintf(w, "# HELP wowrouter_http_inflight Requests currently being served.\n# TYPE wowrouter_http_inflight gauge\nwowrouter_http_inflight %d\n", inflight.Load())
	fmt.Fprintf(w, "# HELP wowrouter_http_last_latency_microseconds Latency of the last completed request.\n# TYPE wowrouter_http_last_latency_microseconds gauge\nwowrouter_http_last_latency_microseconds %d\n", latency.Load())
}
