// Package clientsetup writes local client config files.
// Each write keeps a backup and refuses to replace a file that is not valid for its format.
package clientsetup

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	ClientClaude   = "claude"
	ClientOpenCode = "opencode"
	ClientCodex    = "codex"
)

// Target is one config file the panel can write.
type Target struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	Exists  bool   `json:"exists"`
	Summary string `json:"summary"`
}

// Result describes a write or a restore.
type Result struct {
	Client string `json:"client"`
	Path   string `json:"path"`
	Backup string `json:"backup"`
}

// List returns the three launchers and whether a config already exists.
func List(home string) []Target {
	return []Target{
		{ID: ClientClaude, Name: "Claude Code", Path: filepath.Join(home, ".claude", "settings.json"), Summary: "Sets ANTHROPIC_BASE_URL to this router, without /v1, and ANTHROPIC_AUTH_TOKEN to the router key."},
		{ID: ClientOpenCode, Name: "OpenCode", Path: filepath.Join(home, ".config", "opencode", "opencode.json"), Summary: "Adds a wowrouter provider that uses the OpenAI-compatible base URL."},
		{ID: ClientCodex, Name: "Codex", Path: filepath.Join(home, ".codex", "config.toml"), Summary: "Points the wowrouter model provider at this router and stores the key in auth.json."},
	}
}

// Write updates one client config. confirm must be true. An existing file is copied under backupDir first.
func Write(home, backupDir, client, baseURL, origin, routerKey string, confirm bool) (Result, error) {
	if !confirm {
		return Result{}, errors.New("confirm the write before changing a client config")
	}
	if strings.TrimSpace(routerKey) == "" {
		return Result{}, errors.New("paste a router key first")
	}
	path, err := pathFor(home, client)
	if err != nil {
		return Result{}, err
	}
	backup, err := backupFile(backupDir, client, path)
	if err != nil {
		return Result{}, err
	}
	var next []byte
	switch client {
	case ClientClaude:
		next, err = mergeClaude(path, origin, routerKey)
	case ClientOpenCode:
		next, err = mergeOpenCode(path, baseURL, routerKey)
	case ClientCodex:
		next, err = mergeCodex(path, baseURL)
		if err == nil {
			if authErr := mergeCodexAuth(home, routerKey); authErr != nil {
				return Result{}, authErr
			}
		}
	default:
		err = errors.New("unknown client")
	}
	if err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return Result{}, err
	}
	if err := os.WriteFile(path, next, 0o600); err != nil {
		return Result{}, err
	}
	return Result{Client: client, Path: path, Backup: backup}, nil
}

// Restore copies the newest backup back over the config.
func Restore(home, backupDir, client string, confirm bool) (Result, error) {
	if !confirm {
		return Result{}, errors.New("confirm the restore before replacing a client config")
	}
	path, err := pathFor(home, client)
	if err != nil {
		return Result{}, err
	}
	backup, err := latestBackup(backupDir, client)
	if err != nil {
		return Result{}, err
	}
	raw, err := os.ReadFile(backup)
	if err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return Result{}, err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return Result{}, err
	}
	return Result{Client: client, Path: path, Backup: backup}, nil
}

func pathFor(home, client string) (string, error) {
	for _, target := range List(home) {
		if target.ID == client {
			return target.Path, nil
		}
	}
	return "", errors.New("unknown client")
}

func backupFile(dir, client, path string) (string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	name := client + "-" + time.Now().UTC().Format("20060102T150405.000000000") + filepath.Ext(path)
	dest := filepath.Join(dir, name)
	return dest, os.WriteFile(dest, raw, 0o600)
}

func latestBackup(dir, client string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", errors.New("no backup to restore")
	}
	var newest string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), client+"-") {
			continue
		}
		if entry.Name() > newest {
			newest = entry.Name()
		}
	}
	if newest == "" {
		return "", errors.New("no backup to restore")
	}
	return filepath.Join(dir, newest), nil
}

func mergeClaude(path, origin, key string) ([]byte, error) {
	root, err := readObject(path)
	if err != nil {
		return nil, err
	}
	env, _ := root["env"].(map[string]any)
	if env == nil {
		env = map[string]any{}
	}
	env["ANTHROPIC_BASE_URL"] = origin
	env["ANTHROPIC_AUTH_TOKEN"] = key
	root["env"] = env
	return json.MarshalIndent(root, "", "  ")
}

func mergeOpenCode(path, baseURL, key string) ([]byte, error) {
	root, err := readObject(path)
	if err != nil {
		return nil, err
	}
	provider, _ := root["provider"].(map[string]any)
	if provider == nil {
		provider = map[string]any{}
	}
	provider["wowrouter"] = map[string]any{
		"npm":  "@ai-sdk/openai-compatible",
		"name": "WowRouter",
		"options": map[string]any{
			"baseURL": baseURL,
			"apiKey":  key,
		},
		"models": map[string]any{
			"auto": map[string]any{"name": "Auto"},
		},
	}
	root["provider"] = provider
	return json.MarshalIndent(root, "", "  ")
}

func mergeCodex(path, baseURL string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if len(raw) > 0 && !tomlLooksValid(raw) {
		return nil, errors.New("the existing Codex config is not valid TOML, so it was left unchanged")
	}
	text := stripBlock(string(raw))
	block := "\n# wowrouter-start\nmodel_provider = \"wowrouter\"\n\n[model_providers.wowrouter]\nname = \"WowRouter\"\nbase_url = \"" + baseURL + "\"\nwire_api = \"responses\"\nenv_key = \"OPENAI_API_KEY\"\n# wowrouter-end\n"
	return []byte(strings.TrimSpace(text) + block), nil
}

func mergeCodexAuth(home, key string) error {
	path := filepath.Join(home, ".codex", "auth.json")
	root, err := readObject(path)
	if err != nil {
		return err
	}
	root["OPENAI_API_KEY"] = key
	raw, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func readObject(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return map[string]any{}, nil
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil || root == nil {
		return nil, errors.New("the existing config is not a JSON object, so it was left unchanged")
	}
	return root, nil
}

func tomlLooksValid(raw []byte) bool {
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			continue
		}
		if !strings.Contains(line, "=") {
			return false
		}
	}
	return true
}

func stripBlock(text string) string {
	start := strings.Index(text, "# wowrouter-start")
	end := strings.Index(text, "# wowrouter-end")
	if start >= 0 && end > start {
		text = text[:start] + text[end+len("# wowrouter-end"):]
	}
	return text
}
