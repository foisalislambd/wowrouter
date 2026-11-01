package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// readRSS returns the process resident set in bytes, from VmRSS.
func readRSS(pid int) (int64, error) {
	text, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(text), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0, fmt.Errorf("vmrss: %q", line)
		}
		kb, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			return 0, err
		}
		return kb * 1024, nil
	}
	return 0, fmt.Errorf("vmrss missing for pid %d", pid)
}

// readCPUTicks returns user+system time, including reaped children, in clock ticks.
func readCPUTicks(pid int) (int64, error) {
	text, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, err
	}
	raw := string(text)
	end := strings.LastIndex(raw, ")")
	if end < 0 || end+2 >= len(raw) {
		return 0, fmt.Errorf("stat: %q", raw)
	}
	fields := strings.Fields(raw[end+2:])
	// After comm, utime is field 14 (index 11), stime 15, cutime 16, cstime 17.
	if len(fields) < 15 {
		return 0, fmt.Errorf("stat fields: %d", len(fields))
	}
	var total int64
	for _, idx := range []int{11, 12, 13, 14} {
		n, err := strconv.ParseInt(fields[idx], 10, 64)
		if err != nil {
			return 0, err
		}
		total += n
	}
	return total, nil
}
