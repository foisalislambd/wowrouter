package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestShutdownCallsStopAfterResponding(t *testing.T) {
	called := make(chan struct{}, 1)
	server := &Server{Stop: func() { called <- struct{}{} }}
	req := httptest.NewRequest(http.MethodPost, "/api/shutdown", nil)
	rec := httptest.NewRecorder()
	server.shutdown(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not stop the server")
	}
}
