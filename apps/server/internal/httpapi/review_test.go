package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"airoute/server/internal/admin"
	"airoute/server/internal/provider/openai"
	"airoute/server/internal/store"
)

func TestConsoleStaysInsideItsDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("console"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{ConsoleDir: dir}
	req := httptest.NewRequest(http.MethodGet, "/ui/../../etc/passwd", nil)
	rec := httptest.NewRecorder()
	s.console().ServeHTTP(rec, req)
	if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "root:") {
		t.Fatalf("escaped the console dir: %s", rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/ui/", nil)
	rec = httptest.NewRecorder()
	s.console().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console") {
		t.Fatalf("index %d %s", rec.Code, rec.Body.String())
	}
}

func TestMCPRequiresAKeyAndClassicModelsStayClassic(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "airoute.db"), []byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	gw, token, err := admin.Open(filepath.Join(dir, "gateway.db"))
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
	if _, err := gw.Put("models", "chat", map[string]any{"enabled": true, "target": map[string]any{"type": "block"}}, "", false); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: db, OpenAI: openai.NewClient(), Admin: admin.New(gw, "test")}
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

	classic, err := db.CreateRouterKey("bench")
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"openai/bench-unknown","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+classic.Secret)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("classic model status %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "blocked by the route") {
		t.Fatal("slash model entered the virtual engine")
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"chat","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bootstrap token used as a router key: %d", rec.Code)
	}
}
