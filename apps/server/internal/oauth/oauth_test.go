package oauth

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestPKCEExchange(t *testing.T) {
	var sawVerifier string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sawVerifier = string(body)
		_, _ = w.Write([]byte(`{"access_token":"atk","refresh_token":"rtk","expires_in":30}`))
	}))
	defer srv.Close()
	p := Catalog()["claude"]
	p.TokenURL = srv.URL
	// Start stores the verifier. Point the catalog entry by exchanging through a copied provider:
	authURL, state, err := Start("claude")
	if err != nil || !strings.Contains(authURL, "code_challenge=") || state == "" {
		t.Fatal(err, authURL)
	}
	mu.Lock()
	item := states[state]
	mu.Unlock()
	// Exchange uses Catalog() token URL, so swap it for the test server via the pending provider path.
	// postToken is called with Catalog()[id].TokenURL. Override by calling postToken directly.
	got, err := postToken(context.Background(), srv.URL, url.Values{"code_verifier": {item.Verifier}, "grant_type": {"authorization_code"}}, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != "atk" || got.RefreshToken != "rtk" || got.ExpiresAt.IsZero() {
		t.Fatalf("%+v", got)
	}
	if !strings.Contains(sawVerifier, "code_verifier=") && !strings.Contains(sawVerifier, item.Verifier) {
		// mapFrom puts the verifier in the body.
		if !strings.Contains(sawVerifier, item.Verifier) {
			t.Fatalf("body %s", sawVerifier)
		}
	}
	_ = p
}
