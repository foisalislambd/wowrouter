package migrate

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/secret"

	_ "modernc.org/sqlite"
)

func TestImportKeepsOldFilesAndIsIdempotent(t *testing.T) {
	old := t.TempDir()
	key := bytesKey(t)
	if err := os.WriteFile(filepath.Join(old, "secret.key"), key, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "desktop.json"), []byte(`{"startWithWindows":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	gw, _, err := admin.Open(filepath.Join(old, gatewayDBName))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gw.Put("models", "chat", map[string]any{"enabled": true, "display_name": "Chat"}, "", false); err != nil {
		t.Fatal(err)
	}
	gw.Close()

	sealed, err := secret.Seal(key, "sk-upstream-test")
	if err != nil {
		t.Fatal(err)
	}
	account, err := secret.Seal(key, "sk-account-two")
	if err != nil {
		t.Fatal(err)
	}
	db := createClassic(t, old, sealed, account)
	db.Close()

	classic, err := sql.Open("sqlite", filepath.Join(old, legacyDBName))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := classic.Exec(`INSERT INTO router_keys (id, name, key_hash, key_prefix, created_at) VALUES ('k1', 'laptop', 'abc', 'sk-ai…', '2020-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	classic.Close()

	fresh := t.TempDir()
	if err := Prepare(fresh, []string{old}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(old, legacyDBName)); err != nil {
		t.Fatal("old database was removed")
	}
	if _, err := os.Stat(filepath.Join(old, "secret.key")); err != nil {
		t.Fatal("old secret was removed")
	}
	store, _, err := admin.Open(filepath.Join(fresh, DBName))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := Apply(store, fresh, []string{old}); err != nil {
		t.Fatal(err)
	}
	if err := Apply(store, fresh, []string{old}); err != nil {
		t.Fatal(err)
	}

	got, err := store.Get("providers", "openai")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := got.Private["auth"].(map[string]any)
	if auth["api_key"] != "sk-upstream-test" {
		t.Fatalf("provider key %#v", got.Private["auth"])
	}
	if _, err := store.Get("deployments", deploymentName("openai", "gpt-4o-mini")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("deployments", deploymentName("openai", "gpt-4o")); err == nil {
		t.Fatal("inactive model was imported")
	}
	model, err := store.Get("models", "fallback/daily")
	if err != nil || model.Spec["enabled"] == false {
		t.Fatalf("fallback %#v %v", model.Spec, err)
	}
	chat, err := store.Get("models", "chat")
	if err != nil || chat.Spec["display_name"] != "Chat" {
		t.Fatalf("gateway model %#v %v", chat.Spec, err)
	}
	keys := store.Resources("keys")
	if len(keys) != 0 {
		t.Fatalf("old router keys were imported: %#v", keys)
	}
	if _, ok := store.AuthenticateKey("sk-airoute-abc123"); ok {
		t.Fatal("old router key authenticated")
	}
	logs := store.Logs("", "", 20)
	if len(logs) != 1 {
		t.Fatalf("logs %#v", logs)
	}
	raw, err := os.ReadFile(filepath.Join(fresh, "desktop.json"))
	if err != nil || string(raw) == "" {
		t.Fatalf("desktop settings were not copied: %v", err)
	}
}

func bytesKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	return key
}

func createClassic(t *testing.T, dir, providerKey, accountKey string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dir, legacyDBName))
	if err != nil {
		t.Fatal(err)
	}
	schema := `
CREATE TABLE providers (
  slug TEXT PRIMARY KEY, display_name TEXT, protocol TEXT, base_url TEXT,
  api_key_cipher TEXT, api_key_hint TEXT, enabled INTEGER, updated_at TEXT,
  key_optional INTEGER, models_from_upstream INTEGER, account_strategy TEXT
);
CREATE TABLE models (
  id TEXT PRIMARY KEY, provider_slug TEXT, upstream_id TEXT, display_name TEXT,
  active INTEGER, input_usd_per_million REAL, output_usd_per_million REAL
);
CREATE TABLE router_keys (
  id TEXT PRIMARY KEY, name TEXT, key_hash TEXT, key_prefix TEXT, created_at TEXT
);
CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY, created_at TEXT, source TEXT, model_id TEXT,
  status_code INTEGER, latency_ms INTEGER, prompt_tokens INTEGER,
  completion_tokens INTEGER, error_message TEXT
);
CREATE TABLE fallbacks (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
CREATE TABLE fallback_steps (fallback_id TEXT, position INTEGER, model_id TEXT);
CREATE TABLE provider_accounts (
  id TEXT PRIMARY KEY, provider_slug TEXT, name TEXT, api_key_cipher TEXT,
  priority INTEGER, enabled INTEGER, created_at TEXT
);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO providers VALUES ('openai', 'OpenAI', 'openai_chat', 'https://api.openai.com/v1', ?, 'hint', 1, '2020-01-01T00:00:00Z', 0, 0, 'fill-first')`, providerKey); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO models VALUES ('openai/gpt-4o-mini', 'openai', 'gpt-4o-mini', 'mini', 1, 0.15, 0.6), ('openai/gpt-4o', 'openai', 'gpt-4o', 'full', 0, 2.5, 10)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO request_logs (created_at, source, model_id, status_code, latency_ms, prompt_tokens, completion_tokens, error_message) VALUES ('2020-01-02T00:00:00Z', 'gateway', 'openai/gpt-4o-mini', 200, 10, 3, 4, '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO fallbacks VALUES ('daily', 'Daily', '2020-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO fallback_steps VALUES ('daily', 0, 'openai/gpt-4o-mini')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO provider_accounts VALUES ('a1', 'openai', 'extra', ?, 1, 1, '2020-01-01T00:00:00Z')`, accountKey); err != nil {
		t.Fatal(err)
	}
	return db
}
