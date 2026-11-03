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

func TestGitLabDuckAndDevice(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/status"):
			w.Header().Set("x-vqd-4", "vqd")
			w.WriteHeader(http.StatusOK)
		case strings.HasSuffix(r.URL.Path, "/chat"):
			if r.Header.Get("x-vqd-4") != "vqd" {
				t.Errorf("missing vqd")
			}
			_, _ = w.Write([]byte("data: {\"message\":\"hello duck\"}\n\n"))
		case strings.HasSuffix(r.URL.Path, "/code_suggestions/completions"):
			if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Errorf("gitlab auth")
			}
			_, _ = w.Write([]byte(`{"choices":[{"text":"suggestion"}]}`))
		case strings.HasSuffix(r.URL.Path, "/login/device/code"):
			_, _ = w.Write([]byte(`{"device_code":"dev","user_code":"ABCD-1234","verification_uri":"https://example.test/device","interval":1}`))
		case strings.HasSuffix(r.URL.Path, "/login/oauth/access_token"):
			_, _ = w.Write([]byte(`{"access_token":"gho_test","expires_in":60}`))
		case strings.HasSuffix(r.URL.Path, "/api/copilot/chat/completions"):
			if r.Header.Get("Authorization") != "Bearer gho_test" {
				t.Errorf("oauth bearer")
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"enterprise"}}]}`))
		default:
			http.NotFound(w, r)
		}
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
	enabled := true
	base := upstream.URL
	apiKey := "glpat-test"
	if _, err := db.UpdateProvider("gitlab-duo", store.ProviderUpdate{BaseURL: &base, APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetModelActive("gitlab-duo", "duo-chat-haiku-4-5", true); err != nil {
		t.Fatal(err)
	}
	duckBase := upstream.URL + "/duckchat/v1"
	if _, err := db.UpdateProvider("duckduckgo-web", store.ProviderUpdate{BaseURL: &duckBase, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetModelActive("duckduckgo-web", "gpt-5.4-mini", true); err != nil {
		t.Fatal(err)
	}
	ghe := upstream.URL
	if _, err := db.UpdateProvider("ghe-copilot", store.ProviderUpdate{BaseURL: &ghe, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	created, err := db.CreateRouterKey("test")
	if err != nil {
		t.Fatal(err)
	}
	server := New(db, "", "127.0.0.1:8787", dir)

	gitlab := postChat(server, created.Secret, `{"model":"duo-chat-haiku-4-5","messages":[{"role":"user","content":"add a test"}]}`)
	if gitlab.Code != http.StatusOK || !strings.Contains(gitlab.Body.String(), "suggestion") {
		t.Fatalf("gitlab %d %s", gitlab.Code, gitlab.Body.String())
	}
	duck := postChat(server, created.Secret, `{"model":"duckduckgo-web/gpt-5.4-mini","messages":[{"role":"user","content":"hi"}]}`)
	if duck.Code != http.StatusOK || !strings.Contains(duck.Body.String(), "hello duck") {
		t.Fatalf("duck %d %s", duck.Code, duck.Body.String())
	}
	start := httptest.NewRequest(http.MethodPost, "/api/providers/ghe-copilot/oauth/device", strings.NewReader(`{"clientId":"Iv1.example"}`))
	startRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(startRec, start)
	if startRec.Code != http.StatusOK || !strings.Contains(startRec.Body.String(), "ABCD-1234") {
		t.Fatalf("device %d %s", startRec.Code, startRec.Body.String())
	}
	poll := httptest.NewRequest(http.MethodPost, "/api/providers/ghe-copilot/oauth/poll", strings.NewReader(`{}`))
	pollRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(pollRec, poll)
	if pollRec.Code != http.StatusOK || !strings.Contains(pollRec.Body.String(), `"saved":true`) {
		t.Fatalf("poll %d %s", pollRec.Code, pollRec.Body.String())
	}
	if _, err := db.SetModelActive("ghe-copilot", "claude-fable-5", true); err != nil {
		t.Fatal(err)
	}
	gheChat := postChat(server, created.Secret, `{"model":"ghe-copilot/claude-fable-5","messages":[{"role":"user","content":"hi"}]}`)
	if gheChat.Code != http.StatusOK || !strings.Contains(gheChat.Body.String(), "enterprise") {
		t.Fatalf("ghe chat %d %s", gheChat.Code, gheChat.Body.String())
	}
}

func TestMoreAdaptedProtocols(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/chat-completions/HCX-005"):
			if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Errorf("clova auth")
			}
			_, _ = w.Write([]byte("data: {\"message\":{\"content\":\"clova\"}}\n\n"))
		case strings.Contains(r.URL.Path, "/openai/v1/chat/completions"):
			if !strings.Contains(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256") {
				t.Errorf("bedrock auth")
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"bedrock"}}]}`))
		case strings.HasSuffix(r.URL.Path, "/v1/chat/completions"):
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"inflection"}}]}`))
		case strings.HasSuffix(r.URL.Path, "/chat/completions"):
			if r.Header.Get("Authorization") != "Bearer sap-token" {
				t.Errorf("sap auth %s", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"sap"}}]}`))
		case strings.HasSuffix(r.URL.Path, "/oauth/token"):
			_, _ = w.Write([]byte(`{"access_token":"sap-token"}`))
		case strings.HasSuffix(r.URL.Path, "/v1alpha/sessions"):
			if r.Header.Get("x-goog-api-key") == "" {
				t.Errorf("jules key")
			}
			_, _ = w.Write([]byte(`{"name":"sessions/abc"}`))
		case strings.HasSuffix(r.URL.Path, "/prompt"):
			_, _ = w.Write([]byte(`{"prompt_id":"p1"}`))
		case strings.Contains(r.URL.Path, "/history/"):
			_, _ = w.Write([]byte(`{"output":"rendered"}`))
		case strings.HasSuffix(r.URL.Path, "/chat"):
			if r.Header.Get("Authorization") != "Bearer web-token" {
				t.Errorf("session auth")
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"copilot"}}]}`))
		default:
			http.NotFound(w, r)
		}
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
	enabled := true
	enable := func(slug, base, apiKey, model string) {
		t.Helper()
		update := store.ProviderUpdate{BaseURL: &base, Enabled: &enabled}
		if apiKey != "" {
			update.APIKey = &apiKey
		}
		if _, err := db.UpdateProvider(slug, update); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SetModelActive(slug, model, true); err != nil {
			t.Fatal(err)
		}
	}
	enable("clova-studio", upstream.URL+"/v3", "ncp-key", "HCX-005")
	enable("bedrock", upstream.URL+"/openai/v1", "AKID:secret", "anthropic.claude-opus-4-6")
	sapKey := `{"clientid":"cid","clientsecret":"sec","url":"` + upstream.URL + `"}`
	enable("sap-ai-core", upstream.URL+"/deploy", sapKey, "gpt-4o")
	enable("jules", upstream.URL, "jules-key", "session")
	enable("comfyui", upstream.URL, "", "prompt")
	enable("copilot-web", upstream.URL+"/c/api", "web-token", "copilot-pro")
	enable("inflection", upstream.URL+"/v1", "inf-key", "inflection-3-pi")

	created, err := db.CreateRouterKey("test")
	if err != nil {
		t.Fatal(err)
	}
	server := New(db, "", "127.0.0.1:8787", dir)
	checks := []struct{ model, want string }{
		{"clova-studio/HCX-005", "clova"},
		{"bedrock/anthropic.claude-opus-4-6", "bedrock"},
		{"sap-ai-core/gpt-4o", "sap"},
		{"jules/session", "sessions/abc"},
		{"comfyui/prompt", "rendered"},
		{"copilot-web/copilot-pro", "copilot"},
		{"inflection/inflection-3-pi", "inflection"},
	}
	for _, check := range checks {
		got := postChat(server, created.Secret, `{"model":"`+check.model+`","messages":[{"role":"user","content":"hi"}]}`)
		if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), check.want) {
			t.Fatalf("%s %d %s", check.model, got.Code, got.Body.String())
		}
	}
}

func postChat(server *Server, secret, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+secret)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}
