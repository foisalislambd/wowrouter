package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func writeReport(dir string, report *Report) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(filepath.Join(dir, "summary.json"), raw, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "report.md"), []byte(renderReport(report)), 0o644)
}

func renderReport(report *Report) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# WowRouter benchmark %s\n\n", report.StartedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "Version %s, commit %s. Binary `%s`.\n\n", report.Version, report.Commit, report.Binary)
	env := report.Environment
	fmt.Fprintf(&b, "Machine: %s, %d CPUs, GOMAXPROCS %d, memory %s, kernel %s, load average at start %s. Go %s, %s/%s.\n\n",
		emptyDash(env.CPUModel), env.NumCPU, env.GOMAXPROCS, fmtMiB(env.MemTotalBytes), emptyDash(env.Kernel), emptyDash(env.LoadAvg),
		env.GoVersion, env.GOOS, env.GOARCH)
	fmt.Fprintf(&b, "Chat request %d bytes, mock completion %d bytes.\n\n", report.RequestBytes, report.ResponseBytes)
	if report.Quick {
		b.WriteString("This file is a short smoke run (`-quick`), not the full benchmark.\n\n")
	}
	fmt.Fprintf(&b, "Mock self-test (direct): p50 %s, p99 %s, success %.2f%% (%d/%d).\n\n",
		fmtUS(report.SelfTest.LatencyP50Us), fmtUS(report.SelfTest.LatencyP99Us),
		report.SelfTest.SuccessFraction*100, report.SelfTest.Success, report.SelfTest.Offered)
	for _, note := range report.Notes {
		fmt.Fprintf(&b, "- %s\n", note)
	}
	b.WriteString("\n")
	for _, cell := range report.Cells {
		writeCell(&b, cell)
	}
	return b.String()
}

func writeCell(b *strings.Builder, cell CellResult) {
	fmt.Fprintf(b, "## %s (%s)\n\n", cell.Title, cell.ID)
	if cell.Kind == "ladder" {
		writeLadder(b, cell)
		return
	}
	if cell.Kind == "idle" {
		writeIdle(b, cell)
		return
	}
	fmt.Fprintf(b, "Window %ds warm-up + %ds measure, %d repetition(s).\n\n", cell.WarmupSec, cell.MeasureSec, cell.Reps)
	names := targetNames(cell)
	fmt.Fprintf(b, "| |")
	for _, name := range names {
		fmt.Fprintf(b, " %s |", displayTarget(name))
	}
	if cellHasDirect(cell) {
		b.WriteString(" Direct |")
	}
	b.WriteString("\n| --- |")
	for range names {
		b.WriteString(" ---: |")
	}
	if cellHasDirect(cell) {
		b.WriteString(" ---: |")
	}
	b.WriteString("\n")
	row := func(label string, get func(RepResult) string, direct func(RunMetrics) string) {
		fmt.Fprintf(b, "| %s |", label)
		for _, name := range names {
			fmt.Fprintf(b, " %s |", get(cell.Targets[name].Median))
		}
		if cellHasDirect(cell) {
			if med, ok := firstDirect(cell); ok {
				fmt.Fprintf(b, " %s |", direct(med))
			} else {
				b.WriteString(" — |")
			}
		}
		b.WriteString("\n")
	}
	row("Latency p50", func(r RepResult) string { return fmtUS(r.Run.LatencyP50Us) }, func(m RunMetrics) string { return fmtUS(m.LatencyP50Us) })
	row("Latency p99", func(r RepResult) string { return fmtUS(r.Run.LatencyP99Us) }, func(m RunMetrics) string { return fmtUS(m.LatencyP99Us) })
	row("Latency p99.9", func(r RepResult) string { return fmtUS(r.Run.LatencyP999Us) }, func(m RunMetrics) string { return fmtUS(m.LatencyP999Us) })
	if cell.Stream {
		row("TTFT p50", func(r RepResult) string { return fmtUS(r.Run.TTFTP50Us) }, func(m RunMetrics) string { return fmtUS(m.TTFTP50Us) })
		row("TTFT p99", func(r RepResult) string { return fmtUS(r.Run.TTFTP99Us) }, func(m RunMetrics) string { return fmtUS(m.TTFTP99Us) })
		row("TTFT overhead p50", func(r RepResult) string { return overhead(r, r.TTFTOverheadP50Us) }, func(RunMetrics) string { return "—" })
		row("TTFT overhead p99", func(r RepResult) string { return overhead(r, r.TTFTOverheadP99Us) }, func(RunMetrics) string { return "—" })
	}
	row("Overhead p50", func(r RepResult) string { return overhead(r, r.OverheadP50Us) }, func(RunMetrics) string { return "—" })
	row("Overhead p99", func(r RepResult) string { return overhead(r, r.OverheadP99Us) }, func(RunMetrics) string { return "—" })
	row("Overhead p99.9", func(r RepResult) string { return overhead(r, r.OverheadP999Us) }, func(RunMetrics) string { return "—" })
	row("Success", func(r RepResult) string {
		return fmt.Sprintf("%.2f%% (%d/%d)", r.Run.SuccessFraction*100, r.Run.Success, r.Run.Offered)
	}, func(m RunMetrics) string {
		return fmt.Sprintf("%.2f%% (%d/%d)", m.SuccessFraction*100, m.Success, m.Offered)
	})
	if cell.Kind == "closed" {
		row("Success rate", func(r RepResult) string { return fmtRPS(r.Run.SuccessRPS) + " req/s" }, func(m RunMetrics) string { return fmtRPS(m.SuccessRPS) + " req/s" })
	}
	row("Schedule late", func(r RepResult) string { return fmt.Sprintf("%.3f%%", r.Run.LateFraction*100) }, func(m RunMetrics) string {
		return fmt.Sprintf("%.3f%%", m.LateFraction*100)
	})
	row("CPU per request", func(r RepResult) string { return fmt.Sprintf("%.0f µs", r.CPUUsPerRequest) }, func(RunMetrics) string { return "—" })
	row("CPU", func(r RepResult) string { return fmtCores(r.CPUPercent) }, func(RunMetrics) string { return "—" })
	row("Mock CPU", func(r RepResult) string { return fmtCores(r.MockCPUPercent) }, func(RunMetrics) string { return "—" })
	row("Generator CPU", func(r RepResult) string { return fmtCores(r.GeneratorCPUPercent) }, func(RunMetrics) string { return "—" })
	row("Idle RSS", func(r RepResult) string { return fmtMiB(r.IdleRSSBytes) }, func(RunMetrics) string { return "—" })
	row("Peak RSS", func(r RepResult) string { return fmtMiB(r.PeakRSSBytes) }, func(RunMetrics) string { return "—" })
	row("Ready", func(r RepResult) string { return fmt.Sprintf("%d ms", r.ReadyMs) }, func(RunMetrics) string { return "—" })
	b.WriteString("\n")
	for _, name := range names {
		if note := classNote(cell.Targets[name]); note != "" {
			fmt.Fprintf(b, "%s errors across repetitions: %s.\n\n", displayTarget(name), note)
		}
		median := cell.Targets[name].Median
		if median.DirectRan && !median.DirectClean {
			fmt.Fprintf(b, "%s: the median direct run is outside the 5ms p99 baseline rule.\n\n", displayTarget(name))
		}
	}
}

func writeIdle(b *strings.Builder, cell CellResult) {
	fmt.Fprintf(b, "%d repetition(s), sampled after the process is healthy and, for WowRouter, after the provider and key are saved. No chat load.\n\n", cell.Reps)
	fmt.Fprintf(b, "| |")
	names := targetNames(cell)
	for _, name := range names {
		fmt.Fprintf(b, " %s |", displayTarget(name))
	}
	b.WriteString("\n| --- |")
	for range names {
		b.WriteString(" ---: |")
	}
	b.WriteString("\n")
	fmt.Fprintf(b, "| Ready |")
	for _, name := range names {
		fmt.Fprintf(b, " %d ms |", cell.Targets[name].Median.ReadyMs)
	}
	b.WriteString("\n| Idle RSS |")
	for _, name := range names {
		fmt.Fprintf(b, " %s |", fmtMiB(cell.Targets[name].Median.IdleRSSBytes))
	}
	b.WriteString("\n\n")
}

func writeLadder(b *strings.Builder, cell CellResult) {
	b.WriteString("Each step is one repetition, 1s warm-up and 3s measure. The ladder stops at the first step that misses the pass rule.\n\n")
	b.WriteString("| Offered | Success | p50 | p99 | Overhead p50 | Overhead p99 | Direct p99 | Result |\n")
	b.WriteString("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n")
	for _, step := range cell.Steps {
		median := step.Targets["wowrouter"].Median
		result := "pass"
		if cell.LadderStop != "" && strings.HasPrefix(cell.LadderStop, fmt.Sprintf("%d rps:", step.Rate)) {
			result = "stop"
		} else if !median.OverheadValid || !passes(median.Run.Success, median.Run.Offered, time.Duration(median.OverheadP99Us)*time.Microsecond) || !median.DirectClean {
			result = "fail"
		}
		directP99 := "—"
		if median.Direct != nil {
			directP99 = fmtUS(median.Direct.LatencyP99Us)
		}
		fmt.Fprintf(b, "| %d rps | %.2f%% (%d/%d) | %s | %s | %s | %s | %s | %s |\n",
			step.Rate, median.Run.SuccessFraction*100, median.Run.Success, median.Run.Offered,
			fmtUS(median.Run.LatencyP50Us), fmtUS(median.Run.LatencyP99Us),
			overhead(median, median.OverheadP50Us), overhead(median, median.OverheadP99Us),
			directP99, result)
	}
	b.WriteString("\n")
	if cell.SaturationRPS != nil {
		fmt.Fprintf(b, "Highest passing step: **%d rps**.\n\n", *cell.SaturationRPS)
	} else {
		b.WriteString("No step passed.\n\n")
	}
	if cell.LadderStop != "" {
		fmt.Fprintf(b, "Stop note: %s.\n\n", cell.LadderStop)
	}
}

func targetNames(cell CellResult) []string {
	names := make([]string, 0, len(cell.Targets))
	for name := range cell.Targets {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		order := map[string]int{"wowrouter": 0, "proxy": 1}
		return order[names[i]] < order[names[j]]
	})
	return names
}

func displayTarget(name string) string {
	switch name {
	case "wowrouter":
		return "WowRouter"
	case "proxy":
		return "Loopback proxy"
	default:
		return name
	}
}

func cellHasDirect(cell CellResult) bool {
	_, ok := firstDirect(cell)
	return ok
}

func firstDirect(cell CellResult) (RunMetrics, bool) {
	if target, ok := cell.Targets["wowrouter"]; ok && target.Median.Direct != nil {
		return *target.Median.Direct, true
	}
	for _, target := range cell.Targets {
		if target.Median.Direct != nil {
			return *target.Median.Direct, true
		}
	}
	return RunMetrics{}, false
}

func overhead(rep RepResult, us int64) string {
	if !rep.OverheadValid {
		return "—"
	}
	return fmtUS(us)
}

func classNote(target TargetResult) string {
	merged := map[string]int{}
	for _, rep := range target.Reps {
		for key, count := range rep.Run.ErrorsByClass {
			merged[key] += count
		}
		for key, count := range rep.Run.Statuses {
			merged[key] += count
		}
	}
	if len(merged) == 0 {
		return ""
	}
	keys := make([]string, 0, len(merged))
	for key := range merged {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", key, merged[key]))
	}
	return strings.Join(parts, ", ")
}

func fmtUS(us int64) string {
	sign := ""
	if us < 0 {
		sign = "-"
		us = -us
	}
	switch {
	case us < 1000:
		return fmt.Sprintf("%s%d µs", sign, us)
	case us < 1000*1000:
		return fmt.Sprintf("%s%.2f ms", sign, float64(us)/1000)
	default:
		return fmt.Sprintf("%s%.2f s", sign, float64(us)/1e6)
	}
}

func fmtMiB(bytes int64) string {
	if bytes <= 0 {
		return "—"
	}
	return fmt.Sprintf("%.1f MiB", float64(bytes)/(1024*1024))
}

func fmtCores(percent float64) string {
	return fmt.Sprintf("%.2f cores", percent/100)
}

func fmtRPS(value float64) string {
	if value >= 100 {
		return fmt.Sprintf("%.0f", value)
	}
	return fmt.Sprintf("%.1f", value)
}

func emptyDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "—"
	}
	return value
}
