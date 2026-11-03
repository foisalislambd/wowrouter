package clientsetup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteBacksUpAndRestores(t *testing.T) {
	home := t.TempDir()
	backups := t.TempDir()
	path := filepath.Join(home, ".claude", "settings.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{\"theme\":\"dark\"}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Write(home, backups, ClientClaude, "http://127.0.0.1:8787/v1", "http://127.0.0.1:8787", "sk-airoute-test", false); err == nil {
		t.Fatal("expected confirm to be required")
	}
	wrote, err := Write(home, backups, ClientClaude, "http://127.0.0.1:8787/v1", "http://127.0.0.1:8787", "sk-airoute-test", true)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "ANTHROPIC_BASE_URL") || !strings.Contains(text, "http://127.0.0.1:8787\"") || strings.Contains(text, "/v1\"") {
		t.Fatalf("claude settings = %s", text)
	}
	if !strings.Contains(text, "theme") {
		t.Fatal("existing settings were dropped")
	}
	if _, err := Restore(home, backups, ClientClaude, true); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(path)
	if err != nil || string(restored) != "{\"theme\":\"dark\"}" {
		t.Fatalf("restored %s err %v backup %s", restored, err, wrote.Backup)
	}
}

func TestRefuseInvalidJSON(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, ".config", "opencode", "opencode.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Write(home, t.TempDir(), ClientOpenCode, "http://127.0.0.1:8787/v1", "http://127.0.0.1:8787", "sk-test", true)
	if err == nil {
		t.Fatal("expected invalid json to be refused")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != "{not json" {
		t.Fatalf("file changed: %s", raw)
	}
}
