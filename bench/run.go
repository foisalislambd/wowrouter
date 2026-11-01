package main

import (
	"fmt"
	"os"
	"time"
)

type cellPlan struct {
	id      string
	title   string
	kind    string
	rate    int
	conc    int
	warmup  int
	measure int
	reps    int
	expect  int
	stream  bool
	direct  bool
	targets []string
}

type benchHarness struct {
	bin           string
	mock          *childProc
	clk           float64
	gatewayBody   []byte
	directBody    []byte
	streamGateway []byte
	streamDirect  []byte
}

func fullPlans(quick bool) []cellPlan {
	if quick {
		return []cellPlan{
			{id: "h1", title: "Simple chat, open loop", kind: "open", rate: 200, warmup: 1, measure: 2, reps: 1, expect: 200, direct: true, targets: []string{"wowrouter", "proxy"}},
			{id: "closed-64", title: "Closed loop, 8 connections", kind: "closed", conc: 8, warmup: 0, measure: 2, reps: 1, expect: 200, direct: true, targets: []string{"wowrouter", "proxy"}},
			{id: "reject-key", title: "Unknown router key", kind: "open", rate: 200, warmup: 0, measure: 1, reps: 1, expect: 401, targets: []string{"wowrouter"}},
		}
	}
	return []cellPlan{
		{id: "h1", title: "Simple chat at 500 requests per second", kind: "open", rate: 500, warmup: 2, measure: 5, reps: 3, expect: 200, direct: true, targets: []string{"wowrouter", "proxy"}},
		{id: "closed-64", title: "Closed loop, 64 connections", kind: "closed", conc: 64, warmup: 2, measure: 5, reps: 3, expect: 200, direct: true, targets: []string{"wowrouter", "proxy"}},
		{id: "stream", title: "Streaming chat at 200 requests per second", kind: "open", rate: 200, warmup: 2, measure: 5, reps: 3, expect: 200, stream: true, direct: true, targets: []string{"wowrouter"}},
		{id: "chat-1000", title: "Simple chat at 1,000 requests per second", kind: "open", rate: 1000, warmup: 2, measure: 5, reps: 3, expect: 200, direct: true, targets: []string{"wowrouter"}},
		{id: "chat-5000", title: "Simple chat at 5,000 requests per second", kind: "open", rate: 5000, warmup: 2, measure: 3, reps: 3, expect: 200, direct: true, targets: []string{"wowrouter"}},
		{id: "reject-key", title: "Unknown router key at 2,000 requests per second", kind: "open", rate: 2000, warmup: 1, measure: 4, reps: 3, expect: 401, targets: []string{"wowrouter"}},
		{id: "reject-model", title: "Unknown model at 2,000 requests per second", kind: "open", rate: 2000, warmup: 1, measure: 4, reps: 3, expect: 404, targets: []string{"wowrouter"}},
		{id: "idle", title: "Idle memory", kind: "idle", reps: 3, targets: []string{"wowrouter", "proxy"}},
	}
}

func ladderRates() []int {
	return []int{100, 250, 500, 1000, 2000, 4000, 8000}
}

func (h *benchHarness) selfTest(quick bool) (RunMetrics, error) {
	rate, warmup, measure := 2000, 1, 2
	if quick {
		rate, warmup, measure = 300, 0, 1
	}
	metrics := runLoad(h.spec(cellPlan{
		kind: "open", rate: rate, warmup: warmup, measure: measure, expect: 200,
	}, h.mockURL(), upstreamKey, true))
	logf("self-test direct p50=%s p99=%s success=%.2f%% (%d/%d)",
		fmtUS(metrics.LatencyP50Us), fmtUS(metrics.LatencyP99Us), metrics.SuccessFraction*100, metrics.Success, metrics.Offered)
	if metrics.Offered == 0 || float64(metrics.Success) < 0.99*float64(metrics.Offered) {
		return metrics, fmt.Errorf("mock self-test succeeded %d of %d requests", metrics.Success, metrics.Offered)
	}
	return metrics, nil
}

func (h *benchHarness) runAll(quick bool, only map[string]bool) ([]CellResult, error) {
	var cells []CellResult
	for _, plan := range fullPlans(quick) {
		if !want(only, plan.id) {
			continue
		}
		logf("cell %s — %s", plan.id, plan.title)
		cell, err := h.runCell(plan)
		if err != nil {
			return cells, fmt.Errorf("%s: %w", plan.id, err)
		}
		cells = append(cells, cell)
	}
	if !quick && want(only, "ladder") {
		logf("cell ladder — saturation")
		cell, err := h.runLadder()
		if err != nil {
			return cells, fmt.Errorf("ladder: %w", err)
		}
		cells = append(cells, cell)
	}
	return cells, nil
}

func want(only map[string]bool, id string) bool {
	if len(only) == 0 {
		return true
	}
	return only[id]
}

func (h *benchHarness) runCell(plan cellPlan) (CellResult, error) {
	cell := plan.resultShell()
	grouped := map[string][]RepResult{}
	for rep := 1; rep <= plan.reps; rep++ {
		for _, target := range plan.targets {
			result, err := h.oneRep(plan, target)
			if err != nil {
				return cell, fmt.Errorf("rep %d %s: %w", rep, target, err)
			}
			grouped[target] = append(grouped[target], result)
			logRep(plan, rep, target, result)
		}
	}
	cell.Targets = map[string]TargetResult{}
	for name, reps := range grouped {
		cell.Targets[name] = TargetResult{Reps: reps, Median: medianRep(reps)}
	}
	return cell, nil
}

func (h *benchHarness) runLadder() (CellResult, error) {
	cell := CellResult{
		ID: "ladder", Title: "Open-loop saturation, simple chat", Kind: "ladder",
		Expect: 200, WarmupSec: 1, MeasureSec: 3, Reps: 1,
	}
	var lastPass *int
	for _, rate := range ladderRates() {
		plan := cellPlan{
			id: fmt.Sprintf("ladder-%d", rate), title: fmt.Sprintf("Ladder %d rps", rate),
			kind: "open", rate: rate, warmup: 1, measure: 3, reps: 1, expect: 200,
			direct: true, targets: []string{"wowrouter"},
		}
		logf("ladder step %d rps", rate)
		step, err := h.runCell(plan)
		if err != nil {
			return cell, err
		}
		cell.Steps = append(cell.Steps, step)
		median := step.Targets["wowrouter"].Median
		reason := ladderFailure(median)
		if reason != "" {
			cell.LadderStop = fmt.Sprintf("%d rps: %s", rate, reason)
			logf("ladder stop: %s", cell.LadderStop)
			break
		}
		passed := rate
		lastPass = &passed
	}
	if lastPass != nil {
		cell.SaturationRPS = lastPass
	}
	if cell.LadderStop == "" {
		cell.LadderStop = fmt.Sprintf("every step through %d rps passed; the ladder does not go higher", ladderRates()[len(ladderRates())-1])
	}
	return cell, nil
}

func ladderFailure(rep RepResult) string {
	if !rep.DirectRan || rep.Direct == nil {
		return "no direct run"
	}
	if !directClean(rep.Direct.Success, rep.Direct.Offered, rep.Direct.latencyP99()) {
		return "direct run was outside the clean-baseline rule (99.5% success and p99 within 5ms)"
	}
	if !rep.OverheadValid {
		return "gateway run had no successful requests to compare"
	}
	if int64(rep.Run.Success)*1000 < int64(rep.Run.Offered)*995 {
		return "gateway success was under 99.5% of offered requests"
	}
	if time.Duration(rep.OverheadP99Us)*time.Microsecond > 5*time.Millisecond {
		return "p99 overhead was above 5ms"
	}
	return ""
}

func (h *benchHarness) oneRep(plan cellPlan, target string) (RepResult, error) {
	var rep RepResult
	var proc *childProc
	var auth string
	var err error
	dataDir := ""
	started := time.Now()
	switch target {
	case "wowrouter":
		dataDir, err = os.MkdirTemp("", "wowrouter-bench-")
		if err != nil {
			return rep, err
		}
		defer os.RemoveAll(dataDir)
		proc, _, err = startGateway(h.bin, dataDir)
		if err != nil {
			return rep, err
		}
		secret, cfgErr := configureGateway(dataDir, "http://"+mockAddr)
		if cfgErr != nil {
			proc.stop()
			return rep, fmt.Errorf("%w\n%s", cfgErr, proc.tail.String())
		}
		auth = secret
	case "proxy":
		proc, err = startRole("proxy", proxyAddr, "http://"+mockAddr)
		if err != nil {
			return rep, err
		}
		auth = "proxy-unused"
	default:
		return rep, fmt.Errorf("unknown target %s", target)
	}
	defer proc.stop()
	rep.ReadyMs = time.Since(started).Milliseconds()
	time.Sleep(200 * time.Millisecond)
	rep.IdleRSSBytes = sampleIdleRSS(proc.pid())

	if plan.kind == "idle" {
		rep.PeakRSSBytes = rep.IdleRSSBytes
		proc.stop()
		time.Sleep(50 * time.Millisecond)
		return rep, nil
	}

	url := "http://" + gatewayAddr + "/v1/chat/completions"
	if target == "proxy" {
		url = "http://" + proxyAddr + "/v1/chat/completions"
	}
	if err := h.sanity(plan, url, auth); err != nil {
		return rep, fmt.Errorf("%w\n%s", err, proc.tail.String())
	}

	stopPeak := make(chan struct{})
	peakCh := make(chan int64, 1)
	go func() { peakCh <- watchPeakRSS(proc.pid(), stopPeak) }()

	gwCPU := cpuWindow{pid: proc.pid(), clk: h.clk}
	mockCPU := cpuWindow{pid: h.mock.pid(), clk: h.clk}
	genCPU := cpuWindow{pid: os.Getpid(), clk: h.clk}
	spec := h.spec(plan, url, auth, false)
	spec.OnMeasureStart = func() {
		gwCPU.begin()
		mockCPU.begin()
		genCPU.begin()
	}
	spec.OnMeasureEnd = func() {}
	metrics := runLoad(spec)
	close(stopPeak)
	rep.PeakRSSBytes = <-peakCh
	if rep.IdleRSSBytes > rep.PeakRSSBytes {
		rep.PeakRSSBytes = rep.IdleRSSBytes
	}
	per, pct := gwCPU.end(metrics.Completed)
	rep.CPUUsPerRequest = per
	rep.CPUPercent = pct
	_, rep.MockCPUPercent = mockCPU.end(metrics.Completed)
	_, rep.GeneratorCPUPercent = genCPU.end(metrics.Completed)
	rep.Run = metrics

	proc.stop()
	time.Sleep(50 * time.Millisecond)

	if plan.direct {
		direct := runLoad(h.spec(plan, h.mockURL(), upstreamKey, true))
		rep.Direct = &direct
		rep.DirectRan = true
		rep.DirectClean = directClean(direct.Success, direct.Offered, direct.latencyP99())
		if metrics.Success > 0 && direct.Success > 0 {
			rep.OverheadValid = true
			rep.OverheadP50Us = metrics.LatencyP50Us - direct.LatencyP50Us
			rep.OverheadP99Us = metrics.LatencyP99Us - direct.LatencyP99Us
			rep.OverheadP999Us = metrics.LatencyP999Us - direct.LatencyP999Us
			if plan.stream {
				rep.TTFTOverheadP50Us = metrics.TTFTP50Us - direct.TTFTP50Us
				rep.TTFTOverheadP99Us = metrics.TTFTP99Us - direct.TTFTP99Us
			}
		}
	}
	return rep, nil
}

func (h *benchHarness) sanity(plan cellPlan, url, auth string) error {
	probe := plan
	probe.kind = "open"
	probe.rate = 1
	probe.warmup = 0
	probe.measure = 1
	probe.conc = 0
	metrics := runLoad(h.spec(probe, url, auth, false))
	if metrics.Success != 1 {
		return fmt.Errorf("sanity check expected one %d and got success=%d errors=%v statuses=%v",
			plan.expect, metrics.Success, metrics.ErrorsByClass, metrics.Statuses)
	}
	return nil
}

func (h *benchHarness) spec(plan cellPlan, url, auth string, direct bool) LoadSpec {
	body := h.gatewayBody
	switch {
	case plan.id == "reject-model" || (len(plan.id) > 12 && plan.id == "reject-model"):
		body = chatBody("openai/bench-unknown", false)
	case plan.stream && direct:
		body = h.streamDirect
	case plan.stream:
		body = h.streamGateway
	case direct:
		body = h.directBody
	}
	if stringsHasPrefix(plan.id, "ladder-") && direct {
		body = h.directBody
	}
	if plan.id == "reject-key" {
		auth = "sk-wowrouter-bench-unknown"
		if direct {
			auth = upstreamKey
		}
	}
	return LoadSpec{
		URL:         url,
		Body:        body,
		Auth:        auth,
		Rate:        plan.rate,
		Concurrency: plan.conc,
		Warmup:      time.Duration(plan.warmup) * time.Second,
		Measure:     time.Duration(plan.measure) * time.Second,
		Timeout:     defaultTimeout,
		Stream:      plan.stream,
		Expect:      plan.expect,
	}
}

func stringsHasPrefix(value, prefix string) bool {
	return len(value) >= len(prefix) && value[:len(prefix)] == prefix
}

func (h *benchHarness) mockURL() string {
	return "http://" + mockAddr + "/v1/chat/completions"
}

func (p cellPlan) resultShell() CellResult {
	return CellResult{
		ID: p.id, Title: p.title, Kind: p.kind, Rate: p.rate, Concurrency: p.conc,
		Stream: p.stream, Expect: p.expect, WarmupSec: p.warmup, MeasureSec: p.measure, Reps: p.reps,
	}
}

func logRep(plan cellPlan, rep int, target string, result RepResult) {
	if plan.kind == "idle" {
		logf("%s rep %d/%d %s ready=%dms idle=%s", plan.id, rep, plan.reps, target, result.ReadyMs, fmtMiB(result.IdleRSSBytes))
		return
	}
	overhead := "n/a"
	if result.OverheadValid {
		overhead = fmtUS(result.OverheadP50Us)
	}
	logf("%s rep %d/%d %s p50=%s p99=%s overhead_p50=%s success=%.2f%% (%d/%d) late=%.2f%% peak=%s",
		plan.id, rep, plan.reps, target,
		fmtUS(result.Run.LatencyP50Us), fmtUS(result.Run.LatencyP99Us), overhead,
		result.Run.SuccessFraction*100, result.Run.Success, result.Run.Offered,
		result.Run.LateFraction*100, fmtMiB(result.PeakRSSBytes))
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
}

func medianRep(reps []RepResult) RepResult {
	if len(reps) == 0 {
		return RepResult{}
	}
	if len(reps) == 1 {
		return reps[0]
	}
	out := RepResult{DirectRan: reps[0].DirectRan}
	out.ReadyMs = medianField(reps, func(r RepResult) int64 { return r.ReadyMs })
	out.IdleRSSBytes = medianField(reps, func(r RepResult) int64 { return r.IdleRSSBytes })
	out.PeakRSSBytes = medianField(reps, func(r RepResult) int64 { return r.PeakRSSBytes })
	out.CPUUsPerRequest = medianFloat(mapFloat(reps, func(r RepResult) float64 { return r.CPUUsPerRequest }))
	out.CPUPercent = medianFloat(mapFloat(reps, func(r RepResult) float64 { return r.CPUPercent }))
	out.MockCPUPercent = medianFloat(mapFloat(reps, func(r RepResult) float64 { return r.MockCPUPercent }))
	out.GeneratorCPUPercent = medianFloat(mapFloat(reps, func(r RepResult) float64 { return r.GeneratorCPUPercent }))
	out.Run = medianMetrics(mapMetrics(reps, func(r RepResult) RunMetrics { return r.Run }))
	if out.DirectRan {
		var directs []RunMetrics
		for _, rep := range reps {
			if rep.Direct != nil {
				directs = append(directs, *rep.Direct)
			}
		}
		merged := medianMetrics(directs)
		out.Direct = &merged
		out.DirectClean = directClean(merged.Success, merged.Offered, merged.latencyP99())
	}
	var valid []RepResult
	for _, rep := range reps {
		if rep.OverheadValid {
			valid = append(valid, rep)
		}
	}
	if len(valid) > 0 {
		out.OverheadValid = true
		out.OverheadP50Us = medianField(valid, func(r RepResult) int64 { return r.OverheadP50Us })
		out.OverheadP99Us = medianField(valid, func(r RepResult) int64 { return r.OverheadP99Us })
		out.OverheadP999Us = medianField(valid, func(r RepResult) int64 { return r.OverheadP999Us })
		out.TTFTOverheadP50Us = medianField(valid, func(r RepResult) int64 { return r.TTFTOverheadP50Us })
		out.TTFTOverheadP99Us = medianField(valid, func(r RepResult) int64 { return r.TTFTOverheadP99Us })
	}
	return out
}

func medianField(reps []RepResult, get func(RepResult) int64) int64 {
	values := make([]int64, len(reps))
	for i, rep := range reps {
		values[i] = get(rep)
	}
	return medianInt64(values)
}

func mapFloat(reps []RepResult, get func(RepResult) float64) []float64 {
	values := make([]float64, len(reps))
	for i, rep := range reps {
		values[i] = get(rep)
	}
	return values
}

func mapMetrics(reps []RepResult, get func(RepResult) RunMetrics) []RunMetrics {
	values := make([]RunMetrics, len(reps))
	for i, rep := range reps {
		values[i] = get(rep)
	}
	return values
}

func medianMetrics(values []RunMetrics) RunMetrics {
	if len(values) == 0 {
		return RunMetrics{}
	}
	if len(values) == 1 {
		return values[0]
	}
	num := func(get func(RunMetrics) int) int {
		raw := make([]int64, len(values))
		for i, value := range values {
			raw[i] = int64(get(value))
		}
		return int(medianInt64(raw))
	}
	flt := func(get func(RunMetrics) float64) float64 {
		raw := make([]float64, len(values))
		for i, value := range values {
			raw[i] = get(value)
		}
		return medianFloat(raw)
	}
	i64 := func(get func(RunMetrics) int64) int64 {
		raw := make([]int64, len(values))
		for i, value := range values {
			raw[i] = get(value)
		}
		return medianInt64(raw)
	}
	return RunMetrics{
		Offered:         num(func(m RunMetrics) int { return m.Offered }),
		Completed:       num(func(m RunMetrics) int { return m.Completed }),
		Success:         num(func(m RunMetrics) int { return m.Success }),
		Errors:          num(func(m RunMetrics) int { return m.Errors }),
		Late:            num(func(m RunMetrics) int { return m.Late }),
		SuccessFraction: flt(func(m RunMetrics) float64 { return m.SuccessFraction }),
		LateFraction:    flt(func(m RunMetrics) float64 { return m.LateFraction }),
		AchievedRPS:     flt(func(m RunMetrics) float64 { return m.AchievedRPS }),
		SuccessRPS:      flt(func(m RunMetrics) float64 { return m.SuccessRPS }),
		LatencyP50Us:    i64(func(m RunMetrics) int64 { return m.LatencyP50Us }),
		LatencyP99Us:    i64(func(m RunMetrics) int64 { return m.LatencyP99Us }),
		LatencyP999Us:   i64(func(m RunMetrics) int64 { return m.LatencyP999Us }),
		TTFTP50Us:       i64(func(m RunMetrics) int64 { return m.TTFTP50Us }),
		TTFTP99Us:       i64(func(m RunMetrics) int64 { return m.TTFTP99Us }),
	}
}
