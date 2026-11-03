package httpapi

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"airoute/server/internal/secret"
	"airoute/server/internal/store"
)

func TestPanelPasswordIsOffUntilEnabled(t *testing.T) {
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
	handler := server.Handler()

	settings := httptest.NewRecorder()
	handler.ServeHTTP(settings, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if settings.Code != http.StatusOK {
		t.Fatalf("open settings status %d body %s", settings.Code, settings.Body.String())
	}

	enable := httptest.NewRecorder()
	handler.ServeHTTP(enable, jsonRequest(http.MethodPut, "/api/settings/auth", `{"enabled":true,"password":"local-pass"}`))
	if enable.Code != http.StatusOK {
		t.Fatalf("enable status %d body %s", enable.Code, enable.Body.String())
	}
	cookie := enable.Result().Cookies()
	if len(cookie) == 0 || cookie[0].Name != "wowrouter_session" || !cookie[0].HttpOnly {
		t.Fatalf("cookie = %+v", cookie)
	}

	blocked := httptest.NewRecorder()
	handler.ServeHTTP(blocked, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if blocked.Code != http.StatusUnauthorized {
		t.Fatalf("blocked status %d", blocked.Code)
	}

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health %d", health.Code)
	}

	bad := httptest.NewRecorder()
	handler.ServeHTTP(bad, jsonRequest(http.MethodPost, "/api/session", `{"password":"wrong-pass"}`))
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("bad login %d", bad.Code)
	}
	good := httptest.NewRecorder()
	req := jsonRequest(http.MethodPost, "/api/session", `{"password":"local-pass"}`)
	handler.ServeHTTP(good, req)
	if good.Code != http.StatusOK {
		t.Fatalf("login %d %s", good.Code, good.Body.String())
	}
	withCookie := httptest.NewRequest(http.MethodGet, "/api/keys", nil)
	withCookie.AddCookie(good.Result().Cookies()[0])
	keys := httptest.NewRecorder()
	handler.ServeHTTP(keys, withCookie)
	if keys.Code != http.StatusOK {
		t.Fatalf("keys with session %d %s", keys.Code, keys.Body.String())
	}
}

func TestQueryModelsUsesRouterKey(t *testing.T) {
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
	apiKey := "sk-upstream"
	if _, err := db.UpdateProvider("openai", store.ProviderUpdate{APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetModelActive("openai", "gpt-4o-mini", true); err != nil {
		t.Fatal(err)
	}
	created, err := db.CreateRouterKey("query")
	if err != nil {
		t.Fatal(err)
	}
	handler := New(db, "", "127.0.0.1:8787", dir).Handler()
	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, jsonRequest(http.MethodPost, "/v1/models/query", `{"profile":"cheap","limit":3}`))
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("missing key %d", missing.Code)
	}
	req := jsonRequest(http.MethodPost, "/v1/models/query", `{"profile":"cheap","limit":3}`)
	req.Header.Set("Authorization", "Bearer "+created.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte("gpt-4o-mini")) {
		t.Fatalf("query %d %s", rec.Code, rec.Body.String())
	}
	bad := jsonRequest(http.MethodPost, "/v1/models/query", `{"profile":"chaos"}`)
	bad.Header.Set("Authorization", "Bearer "+created.Secret)
	rejected := httptest.NewRecorder()
	handler.ServeHTTP(rejected, bad)
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("profile %d %s", rejected.Code, rejected.Body.String())
	}
}

func jsonRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}
