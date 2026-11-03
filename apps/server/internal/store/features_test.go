package store

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"airoute/server/internal/routeplan"
	"airoute/server/internal/secret"
)

func TestAutoCheapAndRoundRobin(t *testing.T) {
	s := openTestStore(t)
	enabled := true
	apiKey := "sk-test-plan"
	if _, err := s.UpdateProvider("openai", ProviderUpdate{APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	cheap, err := s.SetModelActive("openai", "gpt-4o-mini", true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.SetModelActive("openai", "gpt-6-luna", true)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := s.ResolvePlan("auto/cheap")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Strategy != "auto/cheap" || len(plan.Routes) < 2 {
		t.Fatalf("plan = %+v", plan.Strategy)
	}
	first := routeplan.BlendedPrice(plan.Routes[0].Model.InputUSDPerMillion, plan.Routes[0].Model.OutputUSDPerMillion)
	second := routeplan.BlendedPrice(plan.Routes[1].Model.InputUSDPerMillion, plan.Routes[1].Model.OutputUSDPerMillion)
	if first > second {
		t.Fatalf("cheap order %s (%.4f) then %s (%.4f)", plan.Routes[0].Model.ID, first, plan.Routes[1].Model.ID, second)
	}
	if _, err := s.ResolvePlan("auto"); err != nil {
		t.Fatal(err)
	}

	saved, err := s.SaveFallbackPlan("Daily", []string{cheap.ID, other.ID}, routeplan.StrategyRoundRobin, nil)
	if err != nil || saved.Strategy != routeplan.StrategyRoundRobin {
		t.Fatalf("saved = %+v err=%v", saved, err)
	}
	firstPlan, err := s.ResolvePlan("fallback/daily")
	if err != nil || firstPlan.Routes[0].Model.ID != cheap.ID {
		t.Fatalf("first robin = %+v err=%v", firstPlan, err)
	}
	secondPlan, err := s.ResolvePlan("fallback/daily")
	if err != nil || secondPlan.Routes[0].Model.ID != other.ID {
		t.Fatalf("second robin = %+v err=%v", secondPlan, err)
	}
	costPlan, err := s.SaveFallbackPlan("Cost", []string{cheap.ID, other.ID}, routeplan.StrategyCost, nil)
	if err != nil {
		t.Fatal(err)
	}
	ordered, err := s.ResolvePlan(costPlan.ModelID)
	if err != nil {
		t.Fatal(err)
	}
	if routeplan.BlendedPrice(ordered.Routes[0].Model.InputUSDPerMillion, ordered.Routes[0].Model.OutputUSDPerMillion) >
		routeplan.BlendedPrice(ordered.Routes[1].Model.InputUSDPerMillion, ordered.Routes[1].Model.OutputUSDPerMillion) {
		t.Fatalf("cost plan started with %s", ordered.Routes[0].Model.ID)
	}
}

func TestBudgetAndPassword(t *testing.T) {
	s := openTestStore(t)
	limit := 0.01
	created, err := s.CreateRouterKeyBudget("limited", &limit)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RejectIfOverBudget(created.ID); err != nil {
		t.Fatal(err)
	}
	enabled := true
	apiKey := "sk-test-budget"
	if _, err := s.UpdateProvider("openai", ProviderUpdate{APIKey: &apiKey, Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	model, err := s.SetModelActive("openai", "gpt-4o-mini", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddLog(LogInput{
		Source: "gateway", RouterKeyID: created.ID, ModelID: model.ID, StatusCode: 200,
		PromptTokens: 1_000_000, CompletionTokens: 1_000_000, RouteNote: "direct → " + model.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.RejectIfOverBudget(created.ID); !errors.Is(err, ErrBudget) {
		t.Fatalf("budget err = %v", err)
	}
	keys, err := s.ListRouterKeys()
	if err != nil || len(keys) != 1 || keys[0].MonthlyBudgetUSD == nil || keys[0].MonthSpendUSD <= 0 {
		t.Fatalf("keys = %+v err=%v", keys, err)
	}
	days, err := s.UsageDays(14)
	if err != nil || len(days) != 14 || days[len(days)-1].Requests != 1 {
		t.Fatalf("days = %+v err=%v", days, err)
	}

	if err := s.ConfigurePanelAuth(true, "short", ""); err == nil {
		t.Fatal("short password accepted")
	}
	if err := s.ConfigurePanelAuth(true, "correct horse", ""); err != nil {
		t.Fatal(err)
	}
	on, err := s.PanelAuthEnabled()
	if err != nil || !on {
		t.Fatal(on, err)
	}
	if err := s.CheckPanelPassword("nope nope"); !errors.Is(err, ErrPanelPassword) {
		t.Fatalf("wrong password err = %v", err)
	}
	if err := s.CheckPanelPassword("correct horse"); err != nil {
		t.Fatal(err)
	}
	token, expires, err := s.CreateSession(time.Hour)
	if err != nil || token == "" || !expires.After(time.Now()) {
		t.Fatal(err)
	}
	ok, err := s.ValidSession(token)
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	if err := s.ConfigurePanelAuth(true, "correct horse", ""); !errors.Is(err, ErrPanelPassword) {
		t.Fatalf("change without current = %v", err)
	}
	if err := s.ConfigurePanelAuth(false, "", "correct horse"); err != nil {
		t.Fatal(err)
	}
	on, err = s.PanelAuthEnabled()
	if err != nil || on {
		t.Fatal("password still on", err)
	}
	ok, err = s.ValidSession(token)
	if err != nil || ok {
		t.Fatal("session survived disable")
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	key, err := secret.LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(filepath.Join(dir, "airoute.db"), key)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
