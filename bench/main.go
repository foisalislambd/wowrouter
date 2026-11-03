package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

func main() {
	if err := dispatch(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "bench: %v\n", err)
		os.Exit(1)
	}
}

func dispatch(args []string) error {
	switch os.Getenv("WOWROUTER_BENCH_ROLE") {
	case "mock":
		return serveMock(os.Getenv("WOWROUTER_BENCH_ADDR"))
	case "proxy":
		return serveProxy(os.Getenv("WOWROUTER_BENCH_ADDR"), os.Getenv("WOWROUTER_BENCH_UPSTREAM"))
	case "":
		return run(args)
	default:
		return fmt.Errorf("unknown role %q", os.Getenv("WOWROUTER_BENCH_ROLE"))
	}
}

func run(args []string) (runErr error) {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("this benchmark reads /proc and runs on Linux")
	}
	fs := flag.NewFlagSet("wowrouter-bench", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	bin := fs.String("bin", "", "path to the wowrouter server binary")
	out := fs.String("out", "", "directory for summary.json and report.md")
	version := fs.String("version", "", "wowrouter version string recorded in the report")
	commit := fs.String("commit", "", "git commit recorded in the report")
	quick := fs.Bool("quick", false, "run a short smoke benchmark instead of the full matrix")
	cells := fs.String("cells", "", "comma-separated cell ids to run (default: all)")
	targets := fs.String("targets", "", "comma-separated targets to run (default: every installed gateway)")
	cache := fs.String("cache", "bench/.cache", "directory setup-targets.sh fills with gateway binaries")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *bin == "" {
		return fmt.Errorf("missing -bin (build the server and pass the binary)")
	}
	if _, err := os.Stat(*bin); err != nil {
		return fmt.Errorf("binary: %w", err)
	}
	output := *out
	if output == "" {
		output = fmt.Sprintf("bench/results/%s", time.Now().UTC().Format("20060102T150405Z"))
	}

	clk := clockTicks()
	report := &Report{
		StartedAt:     time.Now().UTC(),
		Version:       *version,
		Commit:        *commit,
		Binary:        *bin,
		Quick:         *quick,
		RequestBytes:  len(chatBody(publicModel, false)),
		ResponseBytes: len(completionBody),
		Environment:   collectEnvironment(clk),
		Notes:         benchmarkNotes(),
	}
	defer func() {
		report.FinishedAt = time.Now().UTC()
		if err := writeReport(output, report); err != nil {
			fmt.Fprintf(os.Stderr, "writing %s: %v\n", output, err)
			if runErr == nil {
				runErr = err
			}
			return
		}
		logf("wrote %s", output)
	}()

	mock, err := startRole("mock", mockAddr, "")
	if err != nil {
		runErr = err
		return runErr
	}
	defer mock.stop()

	h := &benchHarness{
		bin:     *bin,
		mock:    mock,
		clk:     clk,
		cache:   *cache,
		version: *version,
	}
	h.order, report.Targets, report.NotRun = h.selectedTargets(*targets)
	if len(h.order) == 0 {
		runErr = fmt.Errorf("no targets selected")
		return runErr
	}
	logf("targets: %s", strings.Join(h.order, ", "))
	report.SelfTest, runErr = h.selfTest(*quick)
	if runErr != nil {
		return runErr
	}
	report.Cells, runErr = h.runAll(*quick, cellFilter(*cells))
	report.Failures = h.failures
	return runErr
}

func cellFilter(raw string) map[string]bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	out := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out[part] = true
		}
	}
	return out
}

func benchmarkNotes() []string {
	return []string{
		"The generator, the mock, and the gateway share one machine. This is a local measurement, not an isolated multi-machine reference run, and it is not Antirion's published layout, where each role has a c7i machine.",
		"Repetitions are interleaved: within a cell, each gateway runs in turn, then the next repetition starts. The published value is the median of the repetitions.",
		"WowRouter is one gateway, measured as it ships, with the exact response cache turned off. Each chat request checks the router key against an in-memory snapshot, reads that key row from SQLite for project and team, resolves the model, rewrites the body, and calls the upstream. The activity log is queued onto one background SQLite writer. The model chat target is the same gateway configured through the admin API.",
		"The loopback proxy is a baseline that lives in this harness: a Go reverse proxy with no authentication, no rewrite, and no request log. It is not another product.",
		"Other gateways use one key checked on each request where the build has a key, no cache, and request logging off where the build has that switch. LiteLLM runs one worker per CPU. Bifrost uses the pool sizes from its own published benchmark (15000 / 20000 / 10000 on this 4-CPU machine). Its OpenAI-compatible base URL is the mock origin, because Bifrost appends /v1/chat/completions.",
		"Windows stay the ones this harness already published for WowRouter: 3 repetitions, mostly 2s warm-up and 5s measure. That is shorter than Antirion's 5 repetitions of 10s warm-up and 30s measure on dedicated AWS machines.",
		"Portkey's open-source process has no stored client key. Every request sends x-portkey-config with the provider, the upstream key, and custom_host. Helicone's latest published build is 0.2.0-beta.30 and also has no stored client key in this config, so those two skip the rejection cells. OmniRoute forwards an unknown model to the provider, so that cell is skipped; with REQUIRE_API_KEY it does reject an unknown key.",
		"The direct request body always names gpt-4o-mini. A gateway whose public model id differs (openai/gpt-4o-mini, chat, mockl0/gpt-4o-mini) sends a few different bytes. The mock ignores the model name.",
		"Open-loop latency starts at the scheduled send time, so time spent waiting for a slow target counts. Closed-loop latency starts when the attempt starts.",
		"Overhead is the target percentile minus the direct-run percentile from the same repetition. Latency and overhead are medians of those per-repetition values, so the overhead cell is not always the subtraction of the two latency cells.",
		"A direct run is clean when at least 99.5% of its requests succeed and its p99 is within 5ms. Antirion's dedicated-mock rule is 1ms; that bound does not hold on this shared machine, where the direct path itself is about 1–2ms.",
		"The saturation ladder passes a step at 99.5% success and at most 5ms of p99 overhead, and only when the direct run is clean. Each gateway has its own ladder, and a ladder stops at that gateway's first miss.",
		"Requests the generator cannot start within 8s of their scheduled time are counted as not_sent errors. The generator caps in-flight requests at 1024.",
		"Resident memory is the sum of VmRSS for the gateway process and its live children. Shared pages are counted once per process.",
	}
}
