package store

import (
	"path/filepath"
	"strings"
	"testing"

	"airoute/server/internal/secret"
)

func TestProviderKeyAndModelRoute(t *testing.T) {
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

	providers, err := s.ListProviders()
	if err != nil {
		t.Fatal(err)
	}
	if len(providers) < 2 {
		t.Fatalf("expected openai plus compatible providers, got %d", len(providers))
	}
	if providers[0].Slug == "" {
		t.Fatal("empty provider slug")
	}
	var openai Provider
	for _, provider := range providers {
		if provider.Slug == "openai" {
			openai = provider
		}
	}
	if openai.Slug != "openai" {
		t.Fatal("openai provider missing")
	}
	providers = []Provider{openai}
	if providers[0].TotalModels < 8 {
		t.Fatalf("expected curated openai models, got %d", providers[0].TotalModels)
	}

	first, err := s.ListProvidersPage("", "", 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Providers) != 2 || first.Total < 2 || first.Offset != 0 {
		t.Fatalf("page total=%d len=%d", first.Total, len(first.Providers))
	}
	second, err := s.ListProvidersPage("", "", 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Providers) != 2 || second.Providers[0].Slug == first.Providers[0].Slug {
		t.Fatalf("second page overlapped or was short: %s %s", first.Providers[0].Slug, second.Providers[0].Slug)
	}
	found, err := s.ListProvidersPage("official openai chat", "", 24, 0)
	if err != nil || found.Total < 1 || found.Providers[0].Slug != "openai" {
		t.Fatalf("search page = %+v err=%v", found, err)
	}
	if len(first.Categories) < 2 || first.Categories[0].ID != "all" || first.Categories[0].Total != first.Total {
		t.Fatalf("categories = %+v", first.Categories)
	}
	frontier, err := s.ListProvidersPage("", "Frontier", 5, 0)
	if err != nil || frontier.Total < 1 || frontier.Providers[0].Category != "Frontier" {
		t.Fatalf("frontier = %+v err=%v", frontier, err)
	}

	enabledOnly := true
	withoutKey, err := s.UpdateProvider("opencode", ProviderUpdate{Enabled: &enabledOnly})
	if err != nil {
		t.Fatal(err)
	}
	if !withoutKey.Enabled || !withoutKey.KeyOptional || withoutKey.HasAPIKey {
		t.Fatalf("opencode = %+v", withoutKey)
	}

	apiKey := "sk-live-secret-1234"
	enabled := true
	updated, err := s.UpdateProvider("openai", ProviderUpdate{APIKey: &apiKey, Enabled: &enabled})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.HasAPIKey || updated.APIKeyHint != "••••1234" || !updated.Enabled {
		t.Fatalf("updated = %+v", updated)
	}

	model, err := s.SetModelActive("openai", "gpt-6-luna", true)
	if err != nil {
		t.Fatal(err)
	}
	if !model.Active || model.ID != "openai/gpt-6-luna" {
		t.Fatalf("model = %+v", model)
	}

	route, err := s.ResolveRoute("openai/gpt-6-luna")
	if err != nil {
		t.Fatal(err)
	}
	if route.APIKey != apiKey || route.Model.UpstreamID != "gpt-6-luna" || !route.ProviderOn {
		t.Fatalf("route = %+v", route)
	}
	byUpstream, err := s.ResolveRoute("gpt-6-luna")
	if err != nil || byUpstream.Model.ID != route.Model.ID {
		t.Fatalf("upstream resolve: %+v %v", byUpstream, err)
	}

	created, err := s.CreateRouterKey("Cursor")
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.AuthenticateRouterKey(created.Secret)
	if err != nil || id != created.ID {
		t.Fatalf("auth id=%s err=%v", id, err)
	}
	if strings.HasPrefix(strings.TrimPrefix(created.Secret, "sk-airoute-"), created.ID) {
		t.Fatal("router key id is a prefix of the secret")
	}
	if _, err := s.AuthenticateRouterKey("sk-airoute-nope"); err != ErrNotFound {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestListModelsPageSearch(t *testing.T) {
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

	first, err := s.ListModelsPage("openai", "", 2, 0)
	if err != nil || len(first.Models) != 2 || first.Total < 3 {
		t.Fatalf("page = %+v %v", first, err)
	}
	second, err := s.ListModelsPage("openai", "", 2, 2)
	if err != nil || second.Models[0].ID == first.Models[0].ID {
		t.Fatalf("second page = %+v %v", second, err)
	}
	found, err := s.ListModelsPage("openai", "gpt-6-luna", 24, 0)
	if err != nil || found.Total != 1 || found.Models[0].UpstreamID != "gpt-6-luna" {
		t.Fatalf("search = %+v %v", found, err)
	}
}

func TestReplaceProviderModelsSurvivesCatalogSync(t *testing.T) {
	dir := t.TempDir()
	key, err := secret.LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "airoute.db")
	s, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetModelActive("openai", "gpt-6-luna", true); err != nil {
		t.Fatal(err)
	}
	count, err := s.ReplaceProviderModels("openai", []string{"gpt-6-luna", "remote-only"})
	if err != nil || count != 2 {
		t.Fatal(count, err)
	}
	s.Close()

	reopened, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	models, err := reopened.ListModels("openai")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 {
		t.Fatalf("catalog sync replaced loaded models: %d", len(models))
	}
	for _, model := range models {
		if model.UpstreamID == "gpt-6-luna" {
			if !model.Active || model.DisplayName != "GPT-6 Luna" || model.ContextWindow == 0 {
				t.Fatalf("catalog fields were wiped: %+v", model)
			}
		}
		if model.UpstreamID == "remote-only" && model.Description != "Loaded from the provider." {
			t.Fatalf("new model = %+v", model)
		}
	}
}
