package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"airoute/server/internal/secret"
	"airoute/server/internal/store"
)

func TestMessagesTranslatesOpenAI(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			t.Errorf("path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"hello from router"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`)
	}))
	defer upstream.Close()

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
	base := upstream.URL + "/v1"
	enabled := true
	apiKey := "sk-live"
	if _, err := db.UpdateProvider("openai", store.ProviderUpdate{BaseURL: &base, APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetModelActive("openai", "gpt-6-luna", true); err != nil {
		t.Fatal(err)
	}
	created, err := db.CreateRouterKey("test")
	if err != nil {
		t.Fatal(err)
	}
	server := New(db, "", "127.0.0.1:8787", dir)
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"gpt-6-luna","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+created.Secret)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "hello from router") || !strings.Contains(rec.Body.String(), "message") {
		t.Fatalf("body %s", rec.Body.String())
	}

	countReq := httptest.NewRequest(http.MethodPost, "/v1/messages/count_tokens", strings.NewReader(`{"model":"gpt-6-luna","messages":[{"role":"user","content":"hello"}]}`))
	countReq.Header.Set("Authorization", "Bearer "+created.Secret)
	countRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(countRec, countReq)
	if countRec.Code != http.StatusOK || !strings.Contains(countRec.Body.String(), "input_tokens") {
		t.Fatalf("count %d %s", countRec.Code, countRec.Body.String())
	}
}
