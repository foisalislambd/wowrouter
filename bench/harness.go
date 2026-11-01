package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	mockAddr      = "127.0.0.1:19401"
	gatewayAddr   = "127.0.0.1:19410"
	proxyAddr     = "127.0.0.1:19420"
	upstreamKey   = "sk-bench-upstream"
	publicModel   = "openai/gpt-4o-mini"
	upstreamModel = "gpt-4o-mini"
)

type childProc struct {
	cmd    *exec.Cmd
	tail   *tailBuf
	exited chan struct{}
	once   sync.Once
}

func (p *childProc) pid() int {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

func (p *childProc) stop() {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return
	}
	p.once.Do(func() {
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
		select {
		case <-p.exited:
		case <-time.After(3 * time.Second):
			_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
			<-p.exited
		}
	})
}

func (p *childProc) finished() bool {
	if p == nil || p.exited == nil {
		return false
	}
	select {
	case <-p.exited:
		return true
	default:
		return false
	}
}

type tailBuf struct {
	mu  sync.Mutex
	buf []byte
	max int
}

func (t *tailBuf) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > t.max {
		t.buf = append([]byte(nil), t.buf[len(t.buf)-t.max:]...)
	}
	return len(p), nil
}

func (t *tailBuf) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

func startRole(role, addr, upstream string) (*childProc, error) {
	cmd := exec.Command(os.Args[0])
	cmd.Env = append(os.Environ(),
		"WOWROUTER_BENCH_ROLE="+role,
		"WOWROUTER_BENCH_ADDR="+addr,
		"WOWROUTER_BENCH_UPSTREAM="+upstream,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	tail := &tailBuf{max: 8192}
	cmd.Stdout = tail
	cmd.Stderr = tail
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	proc := newChild(cmd, tail)
	if err := waitHealthy("http://"+addr+"/health", 5*time.Second, proc); err != nil {
		proc.stop()
		return nil, fmt.Errorf("%s: %w\n%s", role, err, tail.String())
	}
	return proc, nil
}

func startGateway(bin, dataDir string) (*childProc, time.Duration, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, 0, err
	}
	cmd := exec.Command(bin, "-addr", gatewayAddr, "-data", dataDir)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	tail := &tailBuf{max: 16 << 10}
	cmd.Stdout = tail
	cmd.Stderr = tail
	started := time.Now()
	if err := cmd.Start(); err != nil {
		return nil, 0, err
	}
	proc := newChild(cmd, tail)
	if err := waitHealthy("http://"+gatewayAddr+"/health", 120*time.Second, proc); err != nil {
		proc.stop()
		return nil, 0, fmt.Errorf("gateway: %w\n%s", err, tail.String())
	}
	return proc, time.Since(started), nil
}

func newChild(cmd *exec.Cmd, tail *tailBuf) *childProc {
	proc := &childProc{cmd: cmd, tail: tail, exited: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		close(proc.exited)
	}()
	return proc
}

func waitHealthy(url string, timeout time.Duration, proc *childProc) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: time.Second}
	var last error
	for time.Now().Before(deadline) {
		if proc.finished() {
			return fmt.Errorf("process exited before %s was healthy", url)
		}
		resp, err := client.Get(url)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
			last = fmt.Errorf("status %s", resp.Status)
		} else {
			last = err
		}
		time.Sleep(30 * time.Millisecond)
	}
	if last == nil {
		last = fmt.Errorf("timeout")
	}
	return last
}

func configureGateway(dataDir, mockBase string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(dataDir, "bootstrap-token"))
	if err != nil {
		return "", fmt.Errorf("bootstrap token: %w", err)
	}
	token := strings.TrimSpace(string(raw))
	base := "http://" + gatewayAddr
	body := map[string]any{
		"apiKey":  upstreamKey,
		"baseUrl": mockBase + "/v1",
		"enabled": true,
	}
	if err := apiJSON(http.MethodPut, base+"/api/providers/openai", body, nil, token); err != nil {
		return "", fmt.Errorf("save openai provider: %w", err)
	}
	if err := apiJSON(http.MethodPut, base+"/api/providers/openai/models/"+upstreamModel, map[string]any{"active": true}, nil, token); err != nil {
		return "", fmt.Errorf("activate model: %w", err)
	}
	if err := apiJSON(http.MethodPut, base+"/api/cache", map[string]any{"enabled": false}, nil, token); err != nil {
		return "", fmt.Errorf("disable cache: %w", err)
	}
	var created struct {
		Secret string `json:"secret"`
	}
	if err := apiJSON(http.MethodPost, base+"/api/keys", map[string]any{"name": "bench"}, &created, token); err != nil {
		return "", fmt.Errorf("create router key: %w", err)
	}
	if created.Secret == "" {
		return "", fmt.Errorf("create router key: empty secret")
	}
	return created.Secret, nil
}

func apiJSON(method, url string, body any, dest any, token string) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		text := strings.TrimSpace(string(payload))
		if len(text) > 500 {
			text = text[:500]
		}
		return fmt.Errorf("%s %s: %s", method, url, text)
	}
	if dest != nil && len(payload) > 0 {
		if err := json.Unmarshal(payload, dest); err != nil {
			return err
		}
	}
	return nil
}

func sampleIdleRSS(pid int) int64 {
	var values []int64
	for i := 0; i < 3; i++ {
		if v, err := readRSS(pid); err == nil {
			values = append(values, v)
		}
		if i < 2 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	return medianInt64(values)
}

func watchPeakRSS(pid int, stop <-chan struct{}) int64 {
	var peak int64
	sample := func() {
		v, err := readRSS(pid)
		if err == nil && v > peak {
			peak = v
		}
	}
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	sample()
	for {
		select {
		case <-stop:
			sample()
			return peak
		case <-tick.C:
			sample()
		}
	}
}
