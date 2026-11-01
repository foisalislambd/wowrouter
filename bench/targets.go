package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

const (
	antirionDataAddr  = "127.0.0.1:19430"
	antirionAdminAddr = "127.0.0.1:19431"
	bifrostAddr       = "127.0.0.1:19440"
	litellmAddr       = "127.0.0.1:19450"
	omniAddr          = "127.0.0.1:19460"
	portkeyAddr       = "127.0.0.1:19470"
	heliconeAddr      = "127.0.0.1:19480"

	bifrostKey  = "sk-bf-bench-0123456789abcdef0123"
	litellmKey  = "sk-bench-litellm-master-0123456789"
	portkeyAuth = "sk-portkey-bench-client"
)

// targetOrder is the interleaved order. Drift during a cell reaches every target alike.
var targetOrder = []string{
	"wowrouter", "virtual", "proxy", "antirion", "bifrost", "litellm", "omniroute", "portkey", "helicone",
}

type targetSpec struct {
	Name              string
	Model             string
	RejectModel       string
	RejectModelStatus int
	RejectKey         string
	RejectKeyStatus   int
	Version           string
	Detail            string
}

type liveTarget struct {
	spec  targetSpec
	proc  *childProc
	auth  string
	url   string
	extra map[string]string
}

func (h *benchHarness) catalog() map[string]targetSpec {
	cache := h.cache
	specs := map[string]targetSpec{
		"wowrouter": {
			Name: "wowrouter", Model: publicModel,
			RejectModel: "openai/bench-unknown", RejectModelStatus: 404,
			RejectKey: "sk-airoute-bench-unknown", RejectKeyStatus: 401,
			Version: h.version, Detail: "classic provider/model path; activity log on, one SQLite connection",
		},
		"virtual": {
			Name: "virtual", Model: "chat",
			RejectModel: "bench-unknown", RejectModelStatus: 404,
			RejectKey: "sk-wowrouter-bench-unknown-key", RejectKeyStatus: 401,
			Version: h.version, Detail: "virtual model chat; response cache off; request log on",
		},
		"proxy": {
			Name: "proxy", Model: upstreamModel,
			Version: "harness", Detail: "Go reverse proxy in this harness, not another product",
		},
	}
	if bin := filepath.Join(cache, "bin", "antirion"); fileExists(bin) {
		specs["antirion"] = targetSpec{
			Name: "antirion", Model: upstreamModel,
			RejectModel: "bench-unknown", RejectModelStatus: 404,
			RejectKey: antirionCredential("sk-antirion-", "unknownkey01", strings.Repeat("B", 43)), RejectKeyStatus: 401,
			Version: strings.TrimSpace(commandOutput(bin, "version")),
			Detail:  "P-min: one key, request logs off, no cache, metrics on. Built from the sibling repo.",
		}
	}
	if bin := filepath.Join(cache, "bin", "bifrost-http"); fileExists(bin) {
		specs["bifrost"] = targetSpec{
			Name: "bifrost", Model: "mockl0/" + upstreamModel,
			RejectModel: "mockl0/bench-unknown", RejectModelStatus: 403,
			RejectKey: "sk-bf-bench-unknown-key-000", RejectKeyStatus: 401,
			Version: "2.4.0",
			Detail:  "logging off, one virtual key, pool 15000 / buffer 20000 / concurrency 10000",
		}
	}
	if bin := filepath.Join(cache, "litellm-venv", "bin", "litellm"); fileExists(bin) {
		specs["litellm"] = targetSpec{
			Name: "litellm", Model: upstreamModel,
			RejectModel: "bench-unknown", RejectModelStatus: 400,
			RejectKey: "sk-not-the-litellm-master", RejectKeyStatus: 400,
			Version: "1.106.6",
			Detail:  "master key, no database, spend and error logs off, one worker per CPU",
		}
	}
	if bin := filepath.Join(cache, "npm", "node_modules", ".bin", "omniroute"); fileExists(bin) {
		specs["omniroute"] = targetSpec{
			Name: "omniroute", Model: "openai/" + upstreamModel,
			RejectModel: "openai/bench-unknown", RejectModelStatus: 0,
			RejectKey: "sk-omniroute-bench-unknown", RejectKeyStatus: 401,
			Version: "3.8.52",
			Detail:  "headless on 127.0.0.1, REQUIRE_API_KEY, request log off, compression off, cache bypass. Unknown models are forwarded to the provider.",
		}
	}
	if fileExists(filepath.Join(cache, "npm", "node_modules", "@portkey-ai", "gateway", "build", "start-server.js")) {
		specs["portkey"] = targetSpec{
			Name: "portkey", Model: upstreamModel,
			Version: "1.15.2",
			Detail:  "open-source gateway has no stored client key; provider config is the x-portkey-config header, cache unset",
		}
	}
	if bin := filepath.Join(cache, "bin", "ai-gateway-x86_64-unknown-linux-gnu", "ai-gateway"); fileExists(bin) {
		specs["helicone"] = targetSpec{
			Name: "helicone", Model: "openai/" + upstreamModel,
			Version: strings.TrimSpace(commandOutput(bin, "--version")),
			Detail:  "latest published release is a beta; no stored client key in this build; cache unset",
		}
	}
	return specs
}

func permanentNotRun() []NotRun {
	return []NotRun{
		{Name: "Kong AI Gateway", Reason: "Docker is not installed, and this Ubuntu image has no Kong package. The AI gateway is a Kong plugin, so it was not started."},
		{Name: "Envoy AI Gateway", Reason: "It runs as a Kubernetes controller. This machine has no Kubernetes cluster and no Docker, so it was not started."},
		{Name: "TensorZero", Reason: "The latest GitHub release, 2026.6.0, publishes no gateway binary (the release asset list is empty) and expects a container plus ClickHouse. Docker is not installed, so it was not started."},
	}
}

func (h *benchHarness) selectedTargets(raw string) ([]string, []TargetInfo, []NotRun) {
	cat := h.catalog()
	want := map[string]bool{}
	if strings.TrimSpace(raw) != "" {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				want[part] = true
			}
		}
	}
	var names []string
	var info []TargetInfo
	var missing []NotRun
	for _, name := range targetOrder {
		spec, ok := cat[name]
		if len(want) > 0 && !want[name] {
			continue
		}
		if !ok {
			if len(want) == 0 || want[name] {
				missing = append(missing, NotRun{Name: displayTarget(name), Reason: "not installed under bench/.cache; run ./bench/setup-targets.sh"})
			}
			continue
		}
		names = append(names, name)
		info = append(info, TargetInfo{Name: name, Version: spec.Version, Detail: spec.Detail})
	}
	if len(want) == 0 {
		missing = append(missing, permanentNotRun()...)
	}
	return names, info, missing
}

func (h *benchHarness) launch(name string) (liveTarget, error) {
	spec := h.catalog()[name]
	live := liveTarget{spec: spec}
	var err error
	switch name {
	case "wowrouter":
		err = h.launchWowrouter(&live, false)
	case "virtual":
		err = h.launchWowrouter(&live, true)
	case "proxy":
		live.proc, err = startRole("proxy", proxyAddr, "http://"+mockAddr)
		live.auth = "proxy-unused"
		live.url = "http://" + proxyAddr + "/v1/chat/completions"
	case "antirion":
		err = h.launchAntirion(&live)
	case "bifrost":
		err = h.launchBifrost(&live)
	case "litellm":
		err = h.launchLiteLLM(&live)
	case "omniroute":
		err = h.launchOmniroute(&live)
	case "portkey":
		err = h.launchPortkey(&live)
	case "helicone":
		err = h.launchHelicone(&live)
	default:
		err = fmt.Errorf("unknown target %s", name)
	}
	if err != nil {
		if live.proc != nil {
			live.proc.stop()
			live.proc.closeCleanup()
		}
		return liveTarget{}, err
	}
	return live, nil
}

func (h *benchHarness) launchWowrouter(live *liveTarget, virtual bool) error {
	dataDir, err := os.MkdirTemp("", "wowrouter-bench-")
	if err != nil {
		return err
	}
	live.proc, _, err = startGateway(h.bin, dataDir)
	if err != nil {
		os.RemoveAll(dataDir)
		return err
	}
	live.proc.cleanup = func() { os.RemoveAll(dataDir) }
	if virtual {
		live.auth, err = configureVirtual(dataDir, "http://"+mockAddr)
	} else {
		live.auth, err = configureGateway("http://" + mockAddr)
	}
	if err != nil {
		return fmt.Errorf("%w\n%s", err, live.proc.tail.String())
	}
	live.url = "http://" + gatewayAddr + "/v1/chat/completions"
	return nil
}

func (h *benchHarness) launchAntirion(live *liveTarget) error {
	dir, err := os.MkdirTemp("", "antirion-bench-")
	if err != nil {
		return err
	}
	key := antirionCredential("sk-antirion-", "benchkey0001", strings.Repeat("A", 43))
	admin := antirionCredential("ak-antirion-", "adminbench01", strings.Repeat("C", 43))
	doc := map[string]any{
		"version": 1,
		"server":  map[string]any{"listen": antirionDataAddr},
		"admin":   map[string]any{"listen": antirionAdminAddr},
		"store": map[string]any{
			"backend":  "embedded",
			"embedded": map[string]any{"path": dir},
		},
		"auth": map[string]any{
			"failed_auth_throttle": map[string]any{"max_failures": 1000000000, "window": "1s"},
			"admin":                map[string]any{"bootstrap_token": "${env:ANTIRION_BENCH_ADMIN}"},
		},
		"providers": map[string]any{
			"bench-openai": map[string]any{
				"type": "openai", "base_url": "http://" + mockAddr + "/v1",
				"auth": map[string]any{"method": "api_key", "api_key": upstreamKey},
			},
		},
		"deployments": map[string]any{
			"bench-chat": map[string]any{"provider": "bench-openai", "model": upstreamModel},
		},
		"models": map[string]any{
			upstreamModel: map[string]any{"target": map[string]any{"deployment": "bench-chat"}},
		},
		"organizations": map[string]any{"bench": map[string]any{}},
		"teams":         map[string]any{"bench": map[string]any{"organization": "bench"}},
		"projects":      map[string]any{"bench": map[string]any{"team": "bench"}},
		"keys": map[string]any{
			"bench": map[string]any{"project": "bench", "secret": "${env:ANTIRION_BENCH_KEY}"},
		},
		"observability": map[string]any{
			"request_logs": map[string]any{"enabled": false},
			"metrics":      map[string]any{"enabled": true},
		},
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	cfg := filepath.Join(dir, "gateway.json")
	if err := os.WriteFile(cfg, raw, 0o600); err != nil {
		os.RemoveAll(dir)
		return err
	}
	cmd := exec.Command(filepath.Join(h.cache, "bin", "antirion"), "serve", "--config", cfg)
	cmd.Env = append(os.Environ(), "ANTIRION_BENCH_KEY="+key, "ANTIRION_BENCH_ADMIN="+admin)
	proc, err := startCommand(cmd, "http://"+antirionDataAddr+"/-/readyz", 60*time.Second)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	proc.cleanup = func() { os.RemoveAll(dir) }
	live.proc = proc
	live.auth = key
	live.url = "http://" + antirionDataAddr + "/v1/chat/completions"
	return nil
}

func (h *benchHarness) launchBifrost(live *liveTarget) error {
	dir, err := os.MkdirTemp("", "bifrost-bench-")
	if err != nil {
		return err
	}
	dataDir := filepath.Join(h.cache, "bifrost")
	cfg := map[string]any{
		"client": map[string]any{
			"drop_excess_requests":      false,
			"initial_pool_size":         15000,
			"enable_logging":            false,
			"disable_content_logging":   true,
			"enforce_auth_on_inference": true,
			"allowed_origins":           []string{"*"},
		},
		"framework": map[string]any{
			"pricing": map[string]any{
				"pricing_url":               "file://" + filepath.Join(dataDir, "datasheet.json"),
				"model_parameters_url":      "file://" + filepath.Join(dataDir, "model-parameters.json"),
				"pricing_sync_interval":     86400,
				"mcp_library_sync_interval": 0,
				"live_models_sync_interval": 0,
			},
		},
		"config_store": map[string]any{"enabled": true, "type": "sqlite", "config": map[string]any{"path": filepath.Join(dir, "config.db")}},
		"logs_store":   map[string]any{"enabled": false},
		"providers": map[string]any{
			"mockl0": map[string]any{
				"keys": []any{map[string]any{"name": "mock", "value": upstreamKey, "models": []string{"*"}, "weight": 1}},
				"network_config": map[string]any{
					"base_url": "http://" + mockAddr, "allow_private_network": true,
					"default_request_timeout_in_seconds": 60,
				},
				"concurrency_and_buffer_size": map[string]any{"concurrency": 10000, "buffer_size": 20000},
				"custom_provider_config":      map[string]any{"base_provider_type": "openai"},
			},
		},
		"governance": map[string]any{
			"virtual_keys": []any{map[string]any{
				"id": "bench", "name": "bench", "value": bifrostKey, "is_active": true,
				"allow_all_providers": false,
				"provider_configs": []any{map[string]any{
					"provider": "mockl0", "allowed_models": []string{upstreamModel}, "key_ids": []string{"*"},
				}},
			}},
		},
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o600); err != nil {
		os.RemoveAll(dir)
		return err
	}
	host, port, _ := strings.Cut(bifrostAddr, ":")
	cmd := exec.Command(filepath.Join(h.cache, "bin", "bifrost-http"),
		"-app-dir", dir, "-host", host, "-port", port, "-log-level", "error", "-log-style", "json")
	proc, err := startCommand(cmd, "http://"+bifrostAddr+"/health", 90*time.Second)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	proc.cleanup = func() { os.RemoveAll(dir) }
	live.proc = proc
	live.auth = bifrostKey
	live.url = "http://" + bifrostAddr + "/v1/chat/completions"
	return nil
}

func (h *benchHarness) launchLiteLLM(live *liveTarget) error {
	dir, err := os.MkdirTemp("", "litellm-bench-")
	if err != nil {
		return err
	}
	yaml := fmt.Sprintf(`model_list:
  - model_name: %s
    litellm_params: {model: openai/%s, api_base: "http://%s/v1", api_key: %s}
litellm_settings:
  drop_params: true
  set_verbose: false
  request_timeout: 60
  num_retries: 0
general_settings:
  master_key: %s
  disable_spend_logs: true
  disable_error_logs: true
`, upstreamModel, upstreamModel, mockAddr, upstreamKey, litellmKey)
	cfg := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(cfg, []byte(yaml), 0o600); err != nil {
		os.RemoveAll(dir)
		return err
	}
	host, port, _ := strings.Cut(litellmAddr, ":")
	workers := fmt.Sprintf("%d", runtime.NumCPU())
	cmd := exec.Command(filepath.Join(h.cache, "litellm-venv", "bin", "litellm"),
		"--config", cfg, "--host", host, "--port", port, "--num_workers", workers)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"LITELLM_LOCAL_MODEL_COST_MAP=True",
		"LITELLM_LOG=ERROR",
		"LITELLM_TELEMETRY=False",
		"DISABLE_ADMIN_UI=True",
		"NO_DOCS=True",
	)
	proc, err := startCommand(cmd, "http://"+litellmAddr+"/health/liveliness", 180*time.Second)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	proc.cleanup = func() { os.RemoveAll(dir) }
	live.proc = proc
	live.auth = litellmKey
	live.url = "http://" + litellmAddr + "/v1/chat/completions"
	return nil
}

func (h *benchHarness) launchOmniroute(live *liveTarget) error {
	dir, err := os.MkdirTemp("", "omniroute-bench-")
	if err != nil {
		return err
	}
	bin := filepath.Join(h.cache, "npm", "node_modules", ".bin", "omniroute")
	setup := exec.Command(bin, "setup", "--non-interactive", "--add-provider",
		"--provider", "openai", "--provider-name", "bench",
		"--api-key", upstreamKey,
		"--provider-base-url", "http://"+mockAddr+"/v1",
		"--default-model", upstreamModel)
	setup.Env = append(os.Environ(), "DATA_DIR="+dir, "OMNIROUTE_HEADLESS=1")
	out, err := setup.CombinedOutput()
	if err != nil {
		os.RemoveAll(dir)
		text := string(out)
		if len(text) > 800 {
			text = text[len(text)-800:]
		}
		return fmt.Errorf("omniroute setup: %w\n%s", err, text)
	}
	cmd := exec.Command(bin, "serve", "--headless", "--no-open", "--port", "19460")
	cmd.Env = append(os.Environ(),
		"DATA_DIR="+dir,
		"OMNIROUTE_HEADLESS=1",
		"REQUIRE_API_KEY=true",
		"OMNIROUTE_SERVER_HOST=127.0.0.1",
	)
	proc, err := startCommand(cmd, "http://"+omniAddr+"/api/monitoring/health", 120*time.Second)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	secret, err := omnirouteKey(bin, dir)
	if err != nil {
		proc.stop()
		os.RemoveAll(dir)
		return err
	}
	proc.cleanup = func() { os.RemoveAll(dir) }
	live.proc = proc
	live.auth = secret
	live.url = "http://" + omniAddr + "/v1/chat/completions"
	return nil
}

func omnirouteKey(bin, dataDir string) (string, error) {
	// Management routes require the machine CLI token. The CLI derives it from
	// DATA_DIR, so the key is created through that client rather than a bare POST.
	cmd := exec.Command(bin, "api", "api-keys", "post-api-keys", "--output", "json", "--body", `{"name":"bench"}`)
	cmd.Env = append(os.Environ(),
		"DATA_DIR="+dataDir,
		"OMNIROUTE_BASE_URL=http://"+omniAddr,
		"OMNIROUTE_HEADLESS=1",
		"NO_COLOR=1",
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	text := strings.TrimSpace(stdout.String())
	if err != nil {
		detail := strings.TrimSpace(stderr.String() + "\n" + text)
		if len(detail) > 800 {
			detail = detail[len(detail)-800:]
		}
		return "", fmt.Errorf("omniroute key: %w\n%s", err, detail)
	}
	var created map[string]any
	if jsonErr := json.Unmarshal([]byte(text), &created); jsonErr != nil {
		if i := strings.LastIndex(text, "{"); i >= 0 {
			jsonErr = json.Unmarshal([]byte(text[i:]), &created)
		}
		if jsonErr != nil {
			return "", fmt.Errorf("omniroute key: %w\n%s", jsonErr, text)
		}
	}
	secret := firstString(created, "key", "apiKey", "secret", "token")
	id := firstString(created, "id")
	if secret == "" || id == "" {
		return "", fmt.Errorf("omniroute key response had no secret: %s", text)
	}
	if err := omnirouteTune(bin, dataDir, id); err != nil {
		return "", err
	}
	return secret, nil
}

func firstString(doc map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := doc[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func omnirouteTune(bin, dataDir, id string) error {
	resolved, err := filepath.EvalSymlinks(bin)
	if err != nil {
		resolved = bin
	}
	tokenFile := filepath.Join(filepath.Dir(filepath.Dir(resolved)), "bin", "cli", "utils", "cliToken.mjs")
	script := fmt.Sprintf(`
import { getCliToken, CLI_TOKEN_HEADER } from %q;
const token = await getCliToken();
const res = await fetch(%q, {
  method: "PATCH",
  headers: { [CLI_TOKEN_HEADER]: token, "content-type": "application/json" },
  body: JSON.stringify({ noLog: true, compressionEnabled: false, cacheDefaultMode: "bypass" }),
});
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
`, tokenFile, "http://"+omniAddr+"/api/keys/"+id)
	cmd := exec.Command("node", "--input-type=module", "-e", script)
	cmd.Env = append(os.Environ(), "DATA_DIR="+dataDir, "NO_COLOR=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		text := strings.TrimSpace(string(out))
		if len(text) > 800 {
			text = text[len(text)-800:]
		}
		return fmt.Errorf("omniroute key settings: %w\n%s", err, text)
	}
	return nil
}

func (h *benchHarness) launchPortkey(live *liveTarget) error {
	script := filepath.Join(h.cache, "npm", "node_modules", "@portkey-ai", "gateway", "build", "start-server.js")
	cmd := exec.Command("node", script, "--port=19470", "--headless")
	cmd.Dir = filepath.Dir(script)
	cmd.Env = append(os.Environ(), "PORT=19470", "TRUSTED_CUSTOM_HOSTS=127.0.0.1")
	proc, err := startCommand(cmd, "http://"+portkeyAddr+"/", 30*time.Second)
	if err != nil {
		return err
	}
	cfg := fmt.Sprintf(`{"provider":"openai","api_key":%q,"custom_host":"http://%s/v1"}`, upstreamKey, mockAddr)
	live.proc = proc
	live.auth = portkeyAuth
	live.url = "http://" + portkeyAddr + "/v1/chat/completions"
	live.extra = map[string]string{"x-portkey-config": cfg}
	return nil
}

func (h *benchHarness) launchHelicone(live *liveTarget) error {
	dir, err := os.MkdirTemp("", "helicone-bench-")
	if err != nil {
		return err
	}
	cfg := fmt.Sprintf("providers:\n  openai:\n    base-url: http://%s\n    api-key: %s\n", mockAddr, upstreamKey)
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		os.RemoveAll(dir)
		return err
	}
	bin := filepath.Join(h.cache, "bin", "ai-gateway-x86_64-unknown-linux-gnu", "ai-gateway")
	env := append(os.Environ(),
		"PORT=19480",
		"AI_GATEWAY_PORT=19480",
		"OPENAI_API_KEY="+upstreamKey,
		"OPENAI_BASE_URL=http://"+mockAddr+"/v1",
	)
	cmd := exec.Command(bin, "--config", path)
	cmd.Env = env
	proc, err := startCommand(cmd, "http://"+heliconeAddr+"/health", 15*time.Second)
	if err != nil {
		cmd = exec.Command(bin, "--config", path)
		cmd.Env = env
		proc, err = startCommand(cmd, "http://127.0.0.1:8080/health", 15*time.Second)
		if err != nil {
			os.RemoveAll(dir)
			return err
		}
		live.url = "http://127.0.0.1:8080/ai/chat/completions"
	} else {
		live.url = "http://" + heliconeAddr + "/ai/chat/completions"
	}
	proc.cleanup = func() { os.RemoveAll(dir) }
	live.proc = proc
	live.auth = "placeholder-api-key"
	return nil
}

func startCommand(cmd *exec.Cmd, health string, timeout time.Duration) (*childProc, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	tail := &tailBuf{max: 24 << 10}
	cmd.Stdout = tail
	cmd.Stderr = tail
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	proc := newChild(cmd, tail)
	if err := waitHealthy(health, timeout, proc); err != nil {
		proc.stop()
		text := tail.String()
		if len(text) > 1500 {
			text = text[len(text)-1500:]
		}
		return nil, fmt.Errorf("%s: %w\n%s", health, err, text)
	}
	return proc, nil
}

func (p *childProc) closeCleanup() {
	if p != nil && p.cleanup != nil {
		p.cleanup()
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func commandOutput(bin string, args ...string) string {
	out, err := exec.Command(bin, args...).CombinedOutput()
	if err != nil && len(out) == 0 {
		return ""
	}
	line := strings.TrimSpace(string(out))
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	return line
}

func antirionCredential(prefix, kid, secret string) string {
	body := prefix + kid + "-" + secret
	return body + base62Pad(crc32.ChecksumIEEE([]byte(body)), 6)
}

func base62Pad(n uint32, width int) string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	out := []byte(strings.Repeat("0", width))
	for i := width - 1; i >= 0; i-- {
		out[i] = alphabet[n%62]
		n /= 62
	}
	return string(out)
}
