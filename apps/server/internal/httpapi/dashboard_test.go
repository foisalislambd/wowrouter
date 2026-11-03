package httpapi

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"airoute/server/internal/secret"
	"airoute/server/internal/store"
)

func TestDashboardAndActivityFilter(t *testing.T) {
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
	if err := db.AddLog(store.LogInput{Source: "openai", ModelID: "openai/gpt-4o-mini", StatusCode: 200, LatencyMS: 40, PromptTokens: 10, CompletionTokens: 5}); err != nil {
		t.Fatal(err)
	}
	if err := db.AddLog(store.LogInput{Source: "openai", ModelID: "openai/gpt-4o-mini", StatusCode: 500, LatencyMS: 80, ErrorMessage: "upstream boom"}); err != nil {
		t.Fatal(err)
	}
	server := New(db, "", "127.0.0.1:8787", dir)

	dash := getJSON(t, server, "/api/dashboard")
	if dash.Code != http.StatusOK || !strings.Contains(dash.Body.String(), `"requests":2`) || !strings.Contains(dash.Body.String(), "openai") {
		t.Fatalf("dashboard %d %s", dash.Code, dash.Body.String())
	}
	errorsOnly := getJSON(t, server, "/api/activity?status=error&q=boom")
	if errorsOnly.Code != http.StatusOK || !strings.Contains(errorsOnly.Body.String(), "upstream boom") || strings.Count(errorsOnly.Body.String(), "gpt-4o-mini") != 1 {
		t.Fatalf("filter %d %s", errorsOnly.Code, errorsOnly.Body.String())
	}
	health := getJSON(t, server, "/api/providers/openai/health")
	if health.Code != http.StatusOK || !strings.Contains(health.Body.String(), `"requests":2`) || !strings.Contains(health.Body.String(), `"avgLatencyMs":60`) {
		t.Fatalf("health %d %s", health.Code, health.Body.String())
	}
	ready := getJSON(t, server, "/api/providers?state=ready&limit=5")
	if ready.Code != http.StatusOK {
		t.Fatalf("ready %d %s", ready.Code, ready.Body.String())
	}
}
