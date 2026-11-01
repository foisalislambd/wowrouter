package main

import "time"

// RepResult is one target in one repetition. Overhead is gateway (or proxy)
// latency minus the direct run at the same percentile. It is set only when
// DirectRan is true, and it may be negative.
type RepResult struct {
	ReadyMs             int64       `json:"ready_ms,omitempty"`
	IdleRSSBytes        int64       `json:"idle_rss_bytes,omitempty"`
	PeakRSSBytes        int64       `json:"peak_rss_bytes,omitempty"`
	CPUUsPerRequest     float64     `json:"cpu_us_per_request,omitempty"`
	CPUPercent          float64     `json:"cpu_percent,omitempty"`
	MockCPUPercent      float64     `json:"mock_cpu_percent,omitempty"`
	GeneratorCPUPercent float64     `json:"generator_cpu_percent,omitempty"`
	Run                 RunMetrics  `json:"run"`
	Direct              *RunMetrics `json:"direct,omitempty"`
	DirectRan           bool        `json:"direct_ran"`
	OverheadValid       bool        `json:"overhead_valid"`
	OverheadP50Us       int64       `json:"overhead_p50_us"`
	OverheadP99Us       int64       `json:"overhead_p99_us"`
	OverheadP999Us      int64       `json:"overhead_p999_us"`
	TTFTOverheadP50Us   int64       `json:"ttft_overhead_p50_us,omitempty"`
	TTFTOverheadP99Us   int64       `json:"ttft_overhead_p99_us,omitempty"`
	DirectClean         bool        `json:"direct_clean"`
}

// TargetResult holds every repetition and the per-metric median.
type TargetResult struct {
	Reps   []RepResult `json:"reps"`
	Median RepResult   `json:"median"`
}

// CellResult is one scenario. A ladder cell stores its steps and the highest
// step that passed, when any step passed.
type CellResult struct {
	ID            string                  `json:"id"`
	Title         string                  `json:"title"`
	Kind          string                  `json:"kind"`
	Rate          int                     `json:"rate,omitempty"`
	Concurrency   int                     `json:"concurrency,omitempty"`
	Stream        bool                    `json:"stream"`
	Expect        int                     `json:"expect"`
	WarmupSec     int                     `json:"warmup_sec"`
	MeasureSec    int                     `json:"measure_sec"`
	Reps          int                     `json:"reps"`
	Targets       map[string]TargetResult `json:"targets,omitempty"`
	Steps         []CellResult            `json:"steps,omitempty"`
	SaturationRPS *int                    `json:"saturation_rps,omitempty"`
	LadderStop    string                  `json:"ladder_stop,omitempty"`
}

// Report is the file bench/results/.../summary.json.
type Report struct {
	StartedAt     time.Time    `json:"started_at"`
	FinishedAt    time.Time    `json:"finished_at"`
	Version       string       `json:"version"`
	Commit        string       `json:"commit"`
	Binary        string       `json:"binary"`
	Quick         bool         `json:"quick"`
	RequestBytes  int          `json:"request_bytes"`
	ResponseBytes int          `json:"response_bytes"`
	Environment   Environment  `json:"environment"`
	SelfTest      RunMetrics   `json:"self_test"`
	Cells         []CellResult `json:"cells"`
	Notes         []string     `json:"notes"`
}

// Environment is the machine the harness measured, not a claimed reference lab.
type Environment struct {
	GOOS          string  `json:"goos"`
	GOARCH        string  `json:"goarch"`
	GoVersion     string  `json:"go_version"`
	NumCPU        int     `json:"num_cpu"`
	GOMAXPROCS    int     `json:"gomaxprocs"`
	Kernel        string  `json:"kernel"`
	CPUModel      string  `json:"cpu_model"`
	MemTotalBytes int64   `json:"mem_total_bytes"`
	LoadAvg       string  `json:"load_avg"`
	ClkTck        float64 `json:"clk_tck"`
}
