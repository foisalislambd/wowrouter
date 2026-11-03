package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// readRSS returns the resident set of pid and its live descendants, in bytes.
// Summing VmRSS counts shared pages once per process.
func readRSS(pid int) (int64, error) {
	var total int64
	var saw bool
	for _, id := range treePIDs(pid) {
		n, err := readOneRSS(id)
		if err != nil {
			continue
		}
		saw = true
		total += n
	}
	if !saw {
		return 0, fmt.Errorf("vmrss missing for pid %d", pid)
	}
	return total, nil
}

func readOneRSS(pid int) (int64, error) {
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

// readCPUTicks returns user and system time for pid and its live descendants,
// including children that have already exited, in clock ticks.
func readCPUTicks(pid int) (int64, error) {
	var total int64
	var saw bool
	for _, id := range treePIDs(pid) {
		n, err := readOneCPUTicks(id)
		if err != nil {
			continue
		}
		saw = true
		total += n
	}
	if !saw {
		return 0, fmt.Errorf("stat missing for pid %d", pid)
	}
	return total, nil
}

func readOneCPUTicks(pid int) (int64, error) {
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
	// cutime and cstime are exited children only, so adding a live child's own
	// utime does not count that child twice.
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

func treePIDs(root int) []int {
	if root <= 0 {
		return nil
	}
	children := map[int][]int{}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return []int{root}
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		ppid := parentPID(pid)
		if ppid > 0 {
			children[ppid] = append(children[ppid], pid)
		}
	}
	out := make([]int, 0, 4)
	stack := []int{root}
	seen := map[int]bool{}
	for len(stack) > 0 {
		pid := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[pid] {
			continue
		}
		seen[pid] = true
		out = append(out, pid)
		stack = append(stack, children[pid]...)
	}
	return out
}

func parentPID(pid int) int {
	text, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	raw := string(text)
	end := strings.LastIndex(raw, ")")
	if end < 0 || end+2 >= len(raw) {
		return 0
	}
	fields := strings.Fields(raw[end+2:])
	// ppid is the first field after comm.
	if len(fields) < 1 {
		return 0
	}
	n, err := strconv.Atoi(fields[0])
	if err != nil {
		return 0
	}
	return n
}
