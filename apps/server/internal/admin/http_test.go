package admin

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

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
