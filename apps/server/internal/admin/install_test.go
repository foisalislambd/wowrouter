package admin

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallVertexAndRejectUnsupported(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	api := New(store, "test")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	api.installPreset(rec, req, "vertex")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing project %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"project_id":"demo-project","region":"europe-west1","access_token":"ya29.demo"}`))
	api.installPreset(rec, req, "vertex")
	if rec.Code != http.StatusCreated {
		t.Fatalf("install %d %s", rec.Code, rec.Body.String())
	}
	res, err := store.Get("providers", "vertex")
	if err != nil {
		t.Fatal(err)
	}
	if res.Spec["type"] != "gemini" || res.Spec["auth_style"] != "bearer" {
		t.Fatalf("public %#v", res.Spec)
	}
	if asString(asMap(res.Spec["auth"])["api_key"]) != "[REDACTED]" {
		t.Fatalf("token leaked %#v", res.Spec["auth"])
	}
	base := asString(res.Private["base_url"])
	if base != "https://europe-west1-aiplatform.googleapis.com/v1/projects/demo-project/locations/europe-west1/publishers/google" {
		t.Fatal(base)
	}
	if asString(asMap(res.Private["auth"])["api_key"]) != "ya29.demo" {
		t.Fatal("private token missing")
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemText := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	payload, _ := json.Marshal(map[string]string{
		"client_email": "vertex@example.iam.gserviceaccount.com",
		"private_key":  pemText,
	})
	body := map[string]any{"project_id": "demo-project", "service_account_json": string(payload)}
	raw, _ := json.Marshal(body)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(string(raw)))
	api.installPreset(rec, req, "vertex-ai")
	if rec.Code != http.StatusCreated {
		t.Fatalf("sa install %d %s", rec.Code, rec.Body.String())
	}
	res, err = store.Get("providers", "vertex-ai")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(asString(res.Private["base_url"]), "/endpoints/openapi") {
		t.Fatal(res.Private["base_url"])
	}
	if asString(asMap(res.Spec["auth"])["service_account_json"]) != "[REDACTED]" {
		t.Fatalf("json leaked %#v", res.Spec["auth"])
	}
	if !strings.Contains(asString(asMap(res.Private["auth"])["service_account_json"]), "private_key") {
		t.Fatal("private json missing")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	api.installPreset(rec, req, "elevenlabs")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Speech") {
		t.Fatalf("elevenlabs %d %s", rec.Code, rec.Body.String())
	}
}
