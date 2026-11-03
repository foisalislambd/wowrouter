package main

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

func clockTicks() float64 {
	out, err := exec.Command("getconf", "CLK_TCK").Output()
	if err != nil {
		return 100
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || value <= 0 {
		return 100
	}
	return value
}

type cpuWindow struct {
	mu    sync.Mutex
	pid   int
	clk   float64
	ticks int64
	at    time.Time
	ok    bool
}

func (w *cpuWindow) begin() {
	w.mu.Lock()
	defer w.mu.Unlock()
	ticks, err := readCPUTicks(w.pid)
	w.at = time.Now()
	if err != nil {
		w.ok = false
		return
	}
	w.ticks = ticks
	w.ok = true
}

// end reports CPU microseconds per completed request and percent of one core.
func (w *cpuWindow) end(completed int) (perRequest float64, percent float64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.ok || w.clk <= 0 {
		return 0, 0
	}
	ticks, err := readCPUTicks(w.pid)
	elapsed := time.Since(w.at)
	if err != nil || elapsed <= 0 {
		return 0, 0
	}
	seconds := float64(ticks-w.ticks) / w.clk
	percent = 100 * seconds / elapsed.Seconds()
	if completed > 0 {
		perRequest = seconds * 1e6 / float64(completed)
	}
	return perRequest, percent
}

func collectEnvironment(clk float64) Environment {
	env := Environment{
		GOOS:       runtime.GOOS,
		GOARCH:     runtime.GOARCH,
		GoVersion:  runtime.Version(),
		NumCPU:     runtime.NumCPU(),
		GOMAXPROCS: runtime.GOMAXPROCS(0),
		ClkTck:     clk,
	}
	if out, err := exec.Command("uname", "-sr").Output(); err == nil {
		env.Kernel = strings.TrimSpace(string(out))
	}
	if text, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		for _, line := range strings.Split(string(text), "\n") {
			if strings.HasPrefix(line, "model name") {
				_, after, _ := strings.Cut(line, ":")
				env.CPUModel = strings.TrimSpace(after)
				break
			}
		}
	}
	if text, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(text), "\n") {
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					if kb, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
						env.MemTotalBytes = kb * 1024
					}
				}
			}
		}
	}
	if text, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(text))
		if len(fields) >= 3 {
			env.LoadAvg = strings.Join(fields[:3], " ")
		}
	}
	return env
}
