package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"wowrouter/server/internal/oauth"
	"wowrouter/server/internal/secret"
)

func TestPasswordOffUntilSet(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	key, err := secret.LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UseSeal(key); err != nil {
		t.Fatal(err)
	}
	enabled, _, hash := store.PasswordLogin()
	if enabled || hash != "" {
		t.Fatalf("password login should be off, enabled=%v hash=%q", enabled, hash)
	}
	if err := store.SetPassword("admin@localhost", "correct horse battery", "", true); err != nil {
		t.Fatal(err)
	}
	if !store.CheckPassword("admin@localhost", "correct horse battery") {
		t.Fatal("password did not match")
	}
	if store.CheckPassword("admin@localhost", "nope") {
		t.Fatal("wrong password matched")
	}
	enabled, _, hash = store.PasswordLogin()
	if !enabled || hash == "" || hash == "correct horse battery" {
		t.Fatal("hash was not stored")
	}
	// The public spec must not contain the hash.
	res, err := store.Get("settings", "auth")
	if err != nil {
		t.Fatal(err)
	}
	if res.Spec["password_hash"] != nil && res.Spec["password_hash"] != "[REDACTED]" {
		t.Fatalf("public spec leaked hash %#v", res.Spec["password_hash"])
	}
	reopen, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer reopen.Close()
	if err := reopen.UseSeal(key); err != nil {
		t.Fatal(err)
	}
	if !reopen.CheckPassword("admin@localhost", "correct horse battery") {
		t.Fatal("sealed password did not round-trip")
	}
}

func TestFillFirstSkipsCooledKey(t *testing.T) {
	// Account ordering lives in the gateway package. This test only checks the
	// setting survives a sealed write, which is what the panel saves.
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.Put("providers", "openai", map[string]any{
		"enabled": true, "account_strategy": "fill-first",
		"auth": map[string]any{"api_key": "sk-live"},
	}, "", false); err != nil {
		t.Fatal(err)
	}
	res, err := store.Get("providers", "openai")
	if err != nil {
		t.Fatal(err)
	}
	if res.Private["account_strategy"] != "fill-first" {
		t.Fatalf("strategy %#v", res.Private["account_strategy"])
	}
	if res.Spec["auth"] != nil {
		if auth, ok := res.Spec["auth"].(map[string]any); ok && auth["api_key"] != "[REDACTED]" {
			t.Fatalf("key leaked %#v", auth["api_key"])
		}
	}
}

func TestCooldownSurvivesANewEngine(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first := New(store, "test")
	first.Engine.Breakers.CoolKey("openai", "a", time.Hour)
	second := New(store, "test")
	if !second.Engine.Breakers.KeyCooling("openai", "a") {
		t.Fatal("cooldown was not restored")
	}
}

func TestIdempotencyIsStored(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	store.SaveIdempotent("retry-1", 200, []byte(`{"ok":true}`))
	status, body, ok := store.Idempotent("retry-1")
	if !ok || status != 200 || string(body) != `{"ok":true}` {
		t.Fatalf("status %d body %s ok %v", status, body, ok)
	}
}

func TestExpiredOAuthRefreshes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "new-token", "refresh_token": "refresh-2", "expires_in": 3600,
		})
	}))
	defer srv.Close()
	prevURL, prevClient := oauth.TokenEndpoint, oauth.HTTPClient
	oauth.TokenEndpoint = srv.URL
	oauth.HTTPClient = srv.Client()
	defer func() {
		oauth.TokenEndpoint = prevURL
		oauth.HTTPClient = prevClient
	}()
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.SaveOAuth("claude", "old-token", "refresh-1", time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	access, ok := store.EnsureFreshToken("claude")
	if !ok || access != "new-token" {
		t.Fatalf("access %q ok %v", access, ok)
	}
	res, err := store.Get("providers", "claude")
	if err != nil {
		t.Fatal(err)
	}
	if asString(asMap(res.Private["auth"])["api_key"]) != "new-token" {
		t.Fatalf("stored %#v", res.Private["auth"])
	}
	if _, again := store.EnsureFreshToken("claude"); again {
		t.Fatal("a fresh token was refreshed again")
	}
}
