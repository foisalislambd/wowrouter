package admin

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapTokenAndRouterKeyPrefix(t *testing.T) {
	dir := t.TempDir()
	store, token, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if token == "" || !strings.HasPrefix(token, "ak-wowrouter-") {
		t.Fatalf("token %q", token)
	}
	created, err := store.Put("keys", "app", map[string]any{"enabled": true}, "", false)
	if err != nil || !strings.HasPrefix(created.Once, "sk-wowrouter-") {
		t.Fatalf("key %q %v", created.Once, err)
	}
	if _, ok := store.AuthenticateKey(created.Once); !ok {
		t.Fatal("new key did not authenticate")
	}
	if _, ok := store.AuthenticateKey("sk-airoute-abc"); ok {
		t.Fatal("old key prefix authenticated")
	}
}

func TestPartialLogAndAuditStillRender(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	store.AddLog(map[string]any{
		"id": "req_partial", "started_at": "2026-11-01T18:00:00Z", "model": "chat",
		"cost": map[string]any{"usd": "0.004200"},
	})
	logs := store.Logs("", "", 10)
	if len(logs) != 1 {
		t.Fatalf("logs %d", len(logs))
	}
	rec := logs[0]
	for _, key := range []string{"tags", "attempts", "guardrails"} {
		if asSlice(rec[key]) == nil {
			t.Fatalf("%s missing", key)
		}
	}
	if asString(asMap(rec["cost"])["total"]) != "0.004200" {
		t.Fatalf("cost %v", rec["cost"])
	}
	if _, ok := rec["stream"]; !ok {
		t.Fatal("stream not set")
	}
	store.AddAudit(map[string]any{"action": "create", "resource": "keys/playground", "at": "2026-11-01T18:00:00Z"})
	audit := store.ListAudit(10)
	if len(audit) == 0 || asMap(audit[0]["actor"])["id"] != "bootstrap" {
		t.Fatalf("audit %#v", audit)
	}
	if asString(audit[0]["action"]) != "keys.create" || asString(audit[0]["time"]) == "" {
		t.Fatalf("audit shape %#v", audit[0])
	}
}
