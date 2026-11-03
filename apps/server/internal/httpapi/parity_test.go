package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"airoute/server/internal/secret"
	"airoute/server/internal/store"
)

func TestParityPagesAndChaos(t *testing.T) {
	dir := t.TempDir()
	key, err := secret.LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(dir, "airoute.db"), key)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server := New(db, "", "127.0.0.1:8787", dir)

	models := getJSON(t, server, "/api/catalog/models?q=gpt&limit=5")
	if models.Code != http.StatusOK || !strings.Contains(models.Body.String(), "models") {
		t.Fatalf("models %d %s", models.Code, models.Body.String())
	}
	preview := postJSON(t, server, "/api/compression/preview", `{"mode":"caveman","text":"please just tell the answer"}`)
	if preview.Code != http.StatusOK || strings.Contains(preview.Body.String(), "please") {
		t.Fatalf("preview %d %s", preview.Code, preview.Body.String())
	}
	translated := postJSON(t, server, "/api/translate", `{"direction":"openai-to-anthropic","body":{"model":"m","messages":[{"role":"system","content":"be brief"},{"role":"user","content":"hi"}]}}`)
	if translated.Code != http.StatusOK || !strings.Contains(translated.Body.String(), "be brief") {
		t.Fatalf("translate %d %s", translated.Code, translated.Body.String())
	}
	hook := postJSON(t, server, "/api/webhooks", `{"url":"http://example.com/hook","secret":"supersecret"}`)
	if hook.Code != http.StatusBadRequest {
		t.Fatalf("public http webhook should be rejected: %d %s", hook.Code, hook.Body.String())
	}
	saved, err := db.SaveGuards(store.GuardSettings{Chaos: true, ChaosFail: 100})
	if err != nil || !saved.Chaos {
		t.Fatal(saved, err)
	}
	enabled := true
	base := "https://example.test/v1"
	apiKey := "sk-test"
	if _, err := db.UpdateProvider("openai", store.ProviderUpdate{BaseURL: &base, APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetModelActive("openai", "gpt-4o-mini", true); err != nil {
		t.Fatal(err)
	}
	chat := postJSON(t, server, "/api/playground/chat", `{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`)
	if chat.Code != http.StatusServiceUnavailable || !strings.Contains(chat.Body.String(), "chaos") {
		t.Fatalf("chaos %d %s", chat.Code, chat.Body.String())
	}
}

func getJSON(t *testing.T, server *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func postJSON(t *testing.T, server *Server, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}
