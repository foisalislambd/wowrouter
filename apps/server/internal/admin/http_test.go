package admin

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"airoute/server/internal/gateway"
)

func TestAdminSessionAndKey(t *testing.T) {
	dir := t.TempDir()
	store, token, err := Open(filepath.Join(dir, "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if token == "" || !strings.HasPrefix(token, "ak-wowrouter-") {
		t.Fatalf("token %q", token)
	}
	api := New(store, "test")
	srv := httptest.NewServer(api)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/admin/v1/auth/session", "application/json", strings.NewReader(`{"token":"nope"}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad token status %d", res.StatusCode)
	}
	res.Body.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/admin/v1/keys", strings.NewReader(`{"name":"app","spec":{"project":"default","enabled":true}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusCreated || !strings.Contains(string(body), "sk-wowrouter-") {
		t.Fatalf("create %d %s", res.StatusCode, body)
	}
	if _, ok := store.AuthenticateKey("sk-wowrouter-missing"); ok {
		t.Fatal("unknown key authenticated")
	}
}

func TestGuardrailRouteRecorded(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := SeedSample(store); err != nil {
		t.Fatal(err)
	}
	api := New(store, "test")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":4,"completion_tokens":1}}`))
	}))
	defer upstream.Close()
	spec := map[string]any{"type": "openai_compatible", "base_url": upstream.URL, "enabled": true, "auth": map[string]any{"api_key": "sk-up"}}
	if _, err := store.Put("providers", "openai", spec, "", false); err != nil {
		t.Fatal(err)
	}
	out := api.Engine.Handle(gateway.Call{
		Model: "chat", Dialect: "openai", KeyName: "playground",
		Body: map[string]any{"model": "chat", "messages": []any{map[string]any{"role": "user", "content": "Hello ada@example.com"}}},
	})
	if out.Status != 200 {
		t.Fatalf("status %d %s body %s", out.Status, out.Error, out.Body)
	}
	logs := store.Logs("", "", 10)
	if len(logs) != 1 || logs[0]["model"] != "chat" {
		t.Fatalf("log %#v", logs)
	}
	if !strings.Contains(string(out.Body), "ok") {
		t.Fatalf("body %s", out.Body)
	}
}

func TestKeyHashStaysPrivateAndRedactedUpdateKeepsTheKey(t *testing.T) {
	dir := t.TempDir()
	store, token, err := Open(filepath.Join(dir, "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	api := New(store, "test")
	srv := httptest.NewServer(api)
	defer srv.Close()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/admin/v1/keys", strings.NewReader(`{"name":"app","spec":{"enabled":true}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(body), "secret_sha256") {
		t.Fatalf("hash leaked on create: %s", body)
	}
	got, err := store.Get("keys", "app")
	if err != nil || got.Private["secret_sha256"] == nil || got.Private["secret_sha256"] == "" {
		t.Fatalf("private hash missing %#v", got.Private)
	}
	if _, ok := got.Spec["secret_sha256"]; ok {
		t.Fatalf("public spec has hash %#v", got.Spec)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-real" {
			http.Error(w, "bad key", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
	}))
	defer upstream.Close()
	if _, err := store.Put("providers", "openai", map[string]any{"type": "openai", "base_url": upstream.URL, "auth": map[string]any{"api_key": "sk-real"}}, "", false); err != nil {
		t.Fatal(err)
	}
	req, _ = http.NewRequest(http.MethodPost, srv.URL+"/admin/v1/providers/openai:test", strings.NewReader(`{"spec":{"type":"openai","base_url":"`+upstream.URL+`","auth":{"api_key":"[REDACTED]"}}}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `"ok":true`) {
		t.Fatalf("test with redacted key: %s", body)
	}
	req, _ = http.NewRequest(http.MethodPost, srv.URL+"/admin/v1/providers:test", strings.NewReader(`{"spec":{"type":"openai","base_url":"http://example.com"}}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(body), `"ok":true`) {
		t.Fatalf("public http base was called: %s", body)
	}
}

func TestShortRateWindowDoesNotPanic(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if !store.AllowRate("bucket", 1, 500*time.Millisecond) {
		t.Fatal("first request rejected")
	}
	if store.AllowRate("bucket", 1, 500*time.Millisecond) {
		t.Fatal("second request in the same second-wide window was allowed")
	}
}
