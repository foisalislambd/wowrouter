package notify

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPostSignsBody(t *testing.T) {
	var sig string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sig = r.Header.Get("X-WowRouter-Signature")
		raw, _ := io.ReadAll(r.Body)
		if len(raw) == 0 {
			t.Fatal("empty body")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	if err := Post(srv.Client(), Channel{Name: "ops", URL: srv.URL, Secret: "sek"}, Message{Title: "hi"}); err != nil {
		t.Fatal(err)
	}
	if len(sig) < 10 || sig[:7] != "sha256=" {
		t.Fatalf("signature %q", sig)
	}
}
