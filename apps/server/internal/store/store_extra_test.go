package store

import (
	"errors"
	"path/filepath"
	"testing"

	"airoute/server/internal/secret"
)

func TestClipTextKeepsWholeRunes(t *testing.T) {
	got := clipText("héllo", 3)
	if got != "hé\n… truncated" {
		t.Fatalf("clip = %q", got)
	}
	if clipText("abcd", 4) != "abcd" {
		t.Fatal("short text was clipped")
	}
}

func TestFallbackChainUsageAndLog(t *testing.T) {
	dir := t.TempDir()
	key, err := secret.LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(filepath.Join(dir, "airoute.db"), key)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	enabled := true
	apiKey := "sk-test-fallback"
	if _, err := s.UpdateProvider("openai", ProviderUpdate{APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	first, err := s.SetModelActive("openai", "gpt-4o-mini", true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.SetModelActive("openai", "gpt-6-luna", true)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.SaveFallback("---", []string{first.ID, second.ID}); err == nil {
		t.Fatal("blank name was accepted")
	}
	if _, err := s.SaveFallback("Daily", []string{first.ID}); err == nil {
		t.Fatal("one model was accepted")
	}
	off, err := s.SetModelActive("openai", "gpt-6-luna", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveFallback("Daily", []string{first.ID, off.ID}); err == nil {
		t.Fatal("turned-off model was accepted")
	}
	if _, err := s.SetModelActive("openai", "gpt-6-luna", true); err != nil {
		t.Fatal(err)
	}

	saved, err := s.SaveFallback("Daily", []string{second.ID, first.ID, first.ID, "fallback/other"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != "daily" || saved.ModelID != "fallback/daily" || len(saved.Models) != 2 || saved.Models[0] != second.ID {
		t.Fatalf("saved = %+v", saved)
	}
	updated, err := s.SaveFallback("daily", []string{first.ID, second.ID})
	if err != nil {
		t.Fatal(err)
	}
	if updated.CreatedAt != saved.CreatedAt || updated.Models[0] != first.ID {
		t.Fatalf("update = %+v saved = %+v", updated, saved)
	}

	routes, err := s.ResolveChain("fallback/daily")
	if err != nil || len(routes) != 2 || routes[0].Model.ID != first.ID || routes[1].APIKey != apiKey {
		t.Fatalf("chain = %+v err=%v", routes, err)
	}
	if _, err := s.db.Exec(`UPDATE fallback_steps SET model_id = ? WHERE fallback_id = ? AND position = 1`, "gone/model", "daily"); err != nil {
		t.Fatal(err)
	}
	routes, err = s.ResolveChain("fallback/daily")
	if err != nil || len(routes) != 1 || routes[0].Model.ID != first.ID {
		t.Fatalf("partial chain = %+v err=%v", routes, err)
	}
	if _, err := s.db.Exec(`UPDATE fallback_steps SET model_id = ? WHERE fallback_id = ?`, "gone/model", "daily"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveChain("fallback/daily"); !errors.Is(err, ErrFallbackEmpty) {
		t.Fatalf("empty chain err = %v", err)
	}

	if err := s.AddLog(LogInput{
		Source: "playground", ModelID: first.ID, StatusCode: 200,
		PromptTokens: 1_000_000, CompletionTokens: 1_000_000, Request: `{"url":"https://example.test"}`,
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddLog(LogInput{Source: "gateway", ModelID: first.ID, StatusCode: 500, ErrorMessage: "no"}); err != nil {
		t.Fatal(err)
	}
	usage, err := s.Usage()
	if err != nil {
		t.Fatal(err)
	}
	var row UsageRow
	for _, item := range usage {
		if item.ModelID == first.ID {
			row = item
		}
	}
	if row.Requests != 2 || row.Errors != 1 || row.PromptTokens != 1_000_000 {
		t.Fatalf("usage = %+v", row)
	}
	want := first.InputUSDPerMillion + first.OutputUSDPerMillion
	if row.CostUSD < want-0.0001 || row.CostUSD > want+0.0001 {
		t.Fatalf("cost = %v want %v", row.CostUSD, want)
	}
	logs, err := s.ListLogs(10)
	if err != nil || len(logs) != 2 || logs[0].RequestJSON != "" {
		t.Fatalf("list leaked request json: %+v %v", logs, err)
	}
	detail, err := s.GetLog(logs[1].ID)
	if err != nil || detail.RequestJSON != `{"url":"https://example.test"}` {
		t.Fatalf("detail = %+v err=%v", detail, err)
	}
	if err := s.ClearLogs(); err != nil {
		t.Fatal(err)
	}
	if n, err := s.CountLogs(); err != nil || n != 0 {
		t.Fatalf("count = %d err=%v", n, err)
	}
	if err := s.DeleteFallback("daily"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveChain("fallback/daily"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted chain err = %v", err)
	}
}
