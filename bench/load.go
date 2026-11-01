package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxInFlight    = 1024
	lateThreshold  = time.Millisecond
	defaultTimeout = 8 * time.Second
	bodyLimit      = 1 << 20
)

// LoadSpec is one open-loop or closed-loop run against a single URL.
type LoadSpec struct {
	URL            string
	Body           []byte
	Auth           string
	Rate           int
	Concurrency    int
	Warmup         time.Duration
	Measure        time.Duration
	Timeout        time.Duration
	Stream         bool
	Expect         int
	OnMeasureStart func()
	OnMeasureEnd   func()
}

type sample struct {
	status  int
	latency time.Duration
	ttft    time.Duration
	late    time.Duration
	class   string
	measure bool
	ok      bool
}

// RunMetrics is the measurement window of one run.
type RunMetrics struct {
	Offered         int            `json:"offered"`
	Completed       int            `json:"completed"`
	Success         int            `json:"success"`
	Errors          int            `json:"errors"`
	Late            int            `json:"late"`
	SuccessFraction float64        `json:"success_fraction"`
	LateFraction    float64        `json:"late_fraction"`
	AchievedRPS     float64        `json:"achieved_rps"`
	SuccessRPS      float64        `json:"success_rps"`
	LatencyP50Us    int64          `json:"latency_p50_us"`
	LatencyP99Us    int64          `json:"latency_p99_us"`
	LatencyP999Us   int64          `json:"latency_p999_us"`
	TTFTP50Us       int64          `json:"ttft_p50_us,omitempty"`
	TTFTP99Us       int64          `json:"ttft_p99_us,omitempty"`
	Statuses        map[string]int `json:"statuses,omitempty"`
	ErrorsByClass   map[string]int `json:"errors_by_class,omitempty"`
}

func (m RunMetrics) latencyP50() time.Duration {
	return time.Duration(m.LatencyP50Us) * time.Microsecond
}
func (m RunMetrics) latencyP99() time.Duration {
	return time.Duration(m.LatencyP99Us) * time.Microsecond
}

func runLoad(spec LoadSpec) RunMetrics {
	if spec.Timeout <= 0 {
		spec.Timeout = defaultTimeout
	}
	if spec.Expect == 0 {
		spec.Expect = http.StatusOK
	}
	client := newLoadClient()
	defer client.CloseIdleConnections()
	if spec.Rate > 0 {
		return summarize(runOpen(spec, client), spec.Measure)
	}
	return summarize(runClosed(spec, client), spec.Measure)
}

func newLoadClient() *http.Client {
	transport := &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:          maxInFlight,
		MaxIdleConnsPerHost:   maxInFlight,
		MaxConnsPerHost:       maxInFlight,
		IdleConnTimeout:       time.Minute,
		TLSHandshakeTimeout:   3 * time.Second,
		ExpectContinueTimeout: 0,
		DisableCompression:    true,
		ForceAttemptHTTP2:     false,
	}
	return &http.Client{Transport: transport}
}

type job struct {
	index     int
	scheduled time.Time
	measure   bool
}

func runOpen(spec LoadSpec, client *http.Client) []sample {
	warmN := int(spec.Rate) * int(spec.Warmup/time.Second)
	measN := int(spec.Rate) * int(spec.Measure/time.Second)
	if measN <= 0 {
		measN = spec.Rate
	}
	total := warmN + measN
	samples := make([]sample, total)
	jobs := make(chan job)
	var wg sync.WaitGroup
	workers := maxInFlight
	if workers > total {
		workers = total
	}
	if workers < 1 {
		workers = 1
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				samples[j.index] = doRequest(client, spec, j.scheduled, j.measure)
			}
		}()
	}
	start := time.Now()
	startedMeasure := false
	for i := 0; i < total; i++ {
		scheduled := start.Add(time.Duration(i) * time.Second / time.Duration(spec.Rate))
		measure := i >= warmN
		if measure && !startedMeasure {
			startedMeasure = true
			if spec.OnMeasureStart != nil {
				spec.OnMeasureStart()
			}
		}
		deadline := scheduled.Add(spec.Timeout)
		if time.Now().After(deadline) {
			samples[i] = notSent(scheduled, measure)
			continue
		}
		waitUntil(scheduled)
		if time.Now().After(deadline) {
			samples[i] = notSent(scheduled, measure)
			continue
		}
		timer := time.NewTimer(time.Until(deadline))
		select {
		case jobs <- job{index: i, scheduled: scheduled, measure: measure}:
			timer.Stop()
		case <-timer.C:
			samples[i] = notSent(scheduled, measure)
		}
	}
	close(jobs)
	wg.Wait()
	if spec.OnMeasureEnd != nil {
		spec.OnMeasureEnd()
	}
	return samples
}

func runClosed(spec LoadSpec, client *http.Client) []sample {
	workers := spec.Concurrency
	if workers < 1 {
		workers = 1
	}
	var mu sync.Mutex
	var samples []sample
	var wg sync.WaitGroup
	start := time.Now()
	warmEnd := start.Add(spec.Warmup)
	measEnd := warmEnd.Add(spec.Measure)
	if spec.Warmup <= 0 {
		if spec.OnMeasureStart != nil {
			spec.OnMeasureStart()
		}
	} else if spec.OnMeasureStart != nil {
		time.AfterFunc(spec.Warmup, spec.OnMeasureStart)
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				now := time.Now()
				if !now.Before(measEnd) {
					return
				}
				measure := !now.Before(warmEnd)
				s := doRequest(client, spec, now, measure)
				if measure {
					mu.Lock()
					samples = append(samples, s)
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	if spec.OnMeasureEnd != nil {
		spec.OnMeasureEnd()
	}
	return samples
}

func notSent(scheduled time.Time, measure bool) sample {
	return sample{
		class:   "not_sent",
		measure: measure,
		late:    time.Since(scheduled),
		latency: time.Since(scheduled),
	}
}

func waitUntil(t time.Time) {
	if d := time.Until(t); d > 0 {
		time.Sleep(d)
	}
}

func doRequest(client *http.Client, spec LoadSpec, scheduled time.Time, measure bool) sample {
	ctx, cancel := context.WithTimeout(context.Background(), spec.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, spec.URL, bytes.NewReader(spec.Body))
	if err != nil {
		return sample{class: "request", measure: measure, latency: time.Since(scheduled)}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+spec.Auth)
	began := time.Now()
	resp, err := client.Do(req)
	out := sample{
		measure: measure,
		late:    began.Sub(scheduled),
		latency: time.Since(scheduled),
	}
	if err != nil {
		out.class = errClass(err)
		out.latency = time.Since(scheduled)
		return out
	}
	defer resp.Body.Close()
	out.status = resp.StatusCode
	body, ttft, readErr := readBody(resp.Body, spec.Stream, scheduled)
	out.latency = time.Since(scheduled)
	out.ttft = ttft
	if readErr != nil {
		out.class = errClass(readErr)
		return out
	}
	out.ok = resp.StatusCode == spec.Expect && bodyMatches(spec, resp.StatusCode, body)
	if !out.ok && out.class == "" {
		out.class = fmtStatus(resp.StatusCode)
	}
	return out
}

func readBody(r io.Reader, stream bool, scheduled time.Time) ([]byte, time.Duration, error) {
	buf := make([]byte, 32*1024)
	var total []byte
	var ttft time.Duration
	first := true
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if first {
				ttft = time.Since(scheduled)
				first = false
			}
			total = append(total, buf[:n]...)
			if len(total) > bodyLimit {
				return total[:bodyLimit], ttft, errors.New("body too large")
			}
		}
		if errors.Is(err, io.EOF) {
			return total, ttft, nil
		}
		if err != nil {
			return total, ttft, err
		}
	}
}

func bodyMatches(spec LoadSpec, status int, body []byte) bool {
	if status != spec.Expect {
		return false
	}
	if spec.Expect != http.StatusOK {
		return true
	}
	if spec.Stream {
		return bytes.Contains(body, []byte("[DONE]"))
	}
	return bytes.Contains(body, []byte(`"chat.completion"`))
}

func errClass(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "timeout"
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "connection refused"):
		return "connect"
	case strings.Contains(msg, "reset by peer"), strings.Contains(msg, "broken pipe"):
		return "reset"
	default:
		return "transport"
	}
}

func fmtStatus(code int) string {
	return "status_" + strconvItoa(code)
}

func strconvItoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

func summarize(samples []sample, window time.Duration) RunMetrics {
	var metrics RunMetrics
	if window <= 0 {
		window = time.Second
	}
	seconds := window.Seconds()
	var latencies []time.Duration
	var ttfts []time.Duration
	statuses := map[string]int{}
	classes := map[string]int{}
	for _, s := range samples {
		if !s.measure {
			continue
		}
		metrics.Offered++
		if s.late > lateThreshold {
			metrics.Late++
		}
		if s.class == "not_sent" {
			metrics.Errors++
			classes["not_sent"]++
			continue
		}
		metrics.Completed++
		if s.ok {
			metrics.Success++
			latencies = append(latencies, s.latency)
			if s.ttft > 0 {
				ttfts = append(ttfts, s.ttft)
			}
			continue
		}
		metrics.Errors++
		if s.status != 0 {
			statuses[fmtStatus(s.status)]++
		}
		if s.class != "" {
			classes[s.class]++
		}
	}
	if metrics.Offered > 0 {
		metrics.SuccessFraction = float64(metrics.Success) / float64(metrics.Offered)
		metrics.LateFraction = float64(metrics.Late) / float64(metrics.Offered)
	}
	metrics.AchievedRPS = float64(metrics.Completed) / seconds
	metrics.SuccessRPS = float64(metrics.Success) / seconds
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	sort.Slice(ttfts, func(i, j int) bool { return ttfts[i] < ttfts[j] })
	metrics.LatencyP50Us = latenciesP(latencies, 0.50)
	metrics.LatencyP99Us = latenciesP(latencies, 0.99)
	metrics.LatencyP999Us = latenciesP(latencies, 0.999)
	metrics.TTFTP50Us = latenciesP(ttfts, 0.50)
	metrics.TTFTP99Us = latenciesP(ttfts, 0.99)
	if len(statuses) > 0 {
		metrics.Statuses = statuses
	}
	if len(classes) > 0 {
		metrics.ErrorsByClass = classes
	}
	return metrics
}

func latenciesP(sorted []time.Duration, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	return percentile(sorted, p).Microseconds()
}
