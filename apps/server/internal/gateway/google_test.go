package gateway

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestApplyProviderKeyHonorsBearer(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://example.com/v1/messages", nil)
	applyProviderKey(req, "anthropic", "bearer", "ya29.token")
	if got := req.Header.Get("Authorization"); got != "Bearer ya29.token" {
		t.Fatal(got)
	}
	if req.Header.Get("x-api-key") != "" {
		t.Fatal("bearer was written as x-api-key")
	}
	req = httptest.NewRequest(http.MethodPost, "https://example.com/models/m:generateContent", nil)
	applyProviderKey(req, "gemini", "bearer", "ya29.token")
	if req.URL.RawQuery != "" || req.Header.Get("Authorization") != "Bearer ya29.token" {
		t.Fatalf("query %q auth %q", req.URL.RawQuery, req.Header.Get("Authorization"))
	}
}

func TestServiceAccountExchange(t *testing.T) {
	googleTokenCache.mu.Lock()
	googleTokenCache.m = nil
	googleTokenCache.mu.Unlock()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemText := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "grant_type=urn") || !strings.Contains(string(body), "assertion=") {
			t.Errorf("body %s", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "ya29.exchanged", "expires_in": 3600})
	}))
	defer srv.Close()
	raw, _ := json.Marshal(map[string]string{
		"client_email": "vertex@example.iam.gserviceaccount.com",
		"private_key":  pemText,
		"token_uri":    srv.URL,
	})
	if err := ValidateServiceAccount(string(raw)); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	tok, err := exchangeServiceAccount(ctx, srv.Client(), string(raw))
	if err != nil || tok != "ya29.exchanged" {
		t.Fatal(tok, err)
	}
	tok, err = exchangeServiceAccount(ctx, srv.Client(), string(raw))
	if err != nil || tok != "ya29.exchanged" || hits != 1 {
		t.Fatalf("tok %s hits %d err %v", tok, hits, err)
	}
	spec := map[string]any{"auth": map[string]any{"service_account_json": string(raw)}}
	got, err := (&Engine{HTTP: srv.Client()}).googleToken(ctx, spec, nil, "")
	if err != nil || got != "ya29.exchanged" {
		t.Fatal(got, err)
	}
	assertion, err := signServiceAccountJWT(serviceAccount{
		ClientEmail: "vertex@example.iam.gserviceaccount.com",
		TokenURI:    srv.URL,
	}, key, time.Unix(1_700_000_000, 0))
	if err != nil || strings.Count(assertion, ".") != 2 {
		t.Fatal(assertion, err)
	}
}
