package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProbe(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"wowrouter"}`))
	}))
	defer server.Close()
	addr := server.Listener.Addr().String()
	if !Probe(addr) {
		t.Fatal("expected a healthy server")
	}
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"airoute"}`))
	}))
	defer legacy.Close()
	if !Probe(legacy.Listener.Addr().String()) {
		t.Fatal("an older airoute health response is still this router")
	}
	if Probe("127.0.0.1:1") {
		t.Fatal("closed port should not look healthy")
	}
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer other.Close()
	if Probe(other.Listener.Addr().String()) {
		t.Fatal("another program on the port is not the WowRouter agent")
	}
}
