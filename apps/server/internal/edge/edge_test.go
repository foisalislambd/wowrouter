package edge

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSAndForwardedIP(t *testing.T) {
	nets, err := ParseCIDRs("10.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}
	h := Wrap(Config{CORSOrigins: []string{"https://app.example.com"}, TrustedProxies: nets}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Client", ClientIP(r))
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.1.2.3:4000"
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Fatal(rec.Header())
	}
	if rec.Header().Get("X-Client") != "203.0.113.9" {
		t.Fatal(rec.Header().Get("X-Client"))
	}
}
