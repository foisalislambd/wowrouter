package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"wowrouter/server/internal/admin"
)

func TestConsoleStaysInsideItsDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("console"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{ConsoleDir: dir}
	req := httptest.NewRequest(http.MethodGet, "/../etc/passwd", nil)
	rec := httptest.NewRecorder()
	s.panel().ServeHTTP(rec, req)
	if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "root:") {
		t.Fatalf("escaped the panel dir: %s", rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	rec = httptest.NewRecorder()
	s.panel().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console") {
		t.Fatalf("index %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/ui/login", nil)
	rec = httptest.NewRecorder()
	s.panel().ServeHTTP(rec, req)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/login" {
		t.Fatalf("ui redirect %d %s", rec.Code, rec.Header().Get("Location"))
	}
}

func TestGatewayKeyCallsDeploymentAndBootstrapTokenDoesNot(t *testing.T) {
	dir := t.TempDir()
	gw, token, err := admin.Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer gw.Close()
	created, err := gw.Put("keys", "app", map[string]any{"enabled": true}, "", false)
	if err != nil || created.Once == "" {
		t.Fatal(err)
	}
	if _, err := gw.Put("mcp/servers", "docs", map[string]any{"url": ""}, "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := gw.Put("providers", "openai", map[string]any{"type": "openai", "enabled": true, "base_url": "http://127.0.0.1:9/v1"}, "", false); err != nil {
		t.Fatal(err)
	}
	if _, err := gw.Put("deployments", "mini", map[string]any{"provider": "openai", "model": "gpt-4o-mini", "enabled": true}, "", false); err != nil {
		t.Fatal(err)
	}
	s := &Server{Admin: admin.New(gw, "test")}
	h := s.Handler()

	req := httptest.NewRequest(http.MethodPost, "/mcp/docs", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("mcp without a key: %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/mcp/docs", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+created.Once)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "docs") {
		t.Fatalf("mcp with a key: %d %s", rec.Code, rec.Body.String())
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-test","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	}))
	defer upstream.Close()
	if _, err := gw.Put("providers", "openai", map[string]any{"type": "openai", "enabled": true, "base_url": upstream.URL + "/v1", "auth": map[string]any{"api_key": "sk-up"}}, "", false); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"openai/missing","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+created.Once)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown model status %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+created.Once)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ok") {
		t.Fatalf("deployment status %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bootstrap token used as a router key: %d", rec.Code)
	}
}
