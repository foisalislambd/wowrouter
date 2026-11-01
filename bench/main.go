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
		bin:           *bin,
		mock:          mock,
		clk:           clk,
		gatewayBody:   chatBody(publicModel, false),
		directBody:    chatBody(upstreamModel, false),
		streamGateway: chatBody(publicModel, true),
		streamDirect:  chatBody(upstreamModel, true),
	}
	report.SelfTest, runErr = h.selfTest(*quick)
	if runErr != nil {
		return runErr
	}
	report.Cells, runErr = h.runAll(*quick, cellFilter(*cells))
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
		"The generator, the mock, and the target share one machine. This is a local measurement, in the spirit of Antirion's laptop topology, not its isolated c7i reference run.",
		"WowRouter is measured as it ships. Each chat request checks the router key, resolves the model, rewrites the body, calls the upstream, updates the account, and appends the activity log. Those database calls share one SQLite connection. Nothing in this run turns that off.",
		"The loopback proxy is a baseline that lives in this harness: a Go reverse proxy with no authentication, no rewrite, and no request log. It is not another product.",
		"Open-loop latency starts at the scheduled send time, so time spent waiting for a slow target counts. Closed-loop latency starts when the attempt starts.",
		"Overhead is the target percentile minus the direct-run percentile from the same repetition. Latency and overhead are medians of those per-repetition values, so the overhead cell is not always the subtraction of the two latency cells.",
		"A direct run is clean when at least 99.5% of its requests succeed and its p99 is within 5ms. Antirion's dedicated-mock rule is 1ms; that bound does not hold on this shared machine, where the direct path itself is about 1–2ms.",
		"The saturation ladder passes a step at 99.5% success and at most 5ms of p99 overhead, and only when the direct run is clean. It stops at the first step that misses.",
		"Requests the generator cannot start within 8s of their scheduled time are counted as not_sent errors. The generator caps in-flight requests at 1024.",
		"Bifrost and LiteLLM are not part of this run. WowRouter listens only on loopback, so this harness cannot place them on separate machines the way Antirion's published comparison does.",
	}
}
