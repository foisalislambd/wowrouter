package catalog

import "testing"

func TestSupportedProvidersLeaveTheRestUnsupported(t *testing.T) {
	by := map[string]Provider{}
	for _, provider := range All() {
		by[provider.Slug] = provider
	}
	working := []string{
		"inflection", "clarifai", "eden-ai", "piapi", "kong-ai-gateway", "inceptron",
		"clova-studio", "codex-cloud", "gitlab-duo", "bedrock", "sap-ai-core",
		"jules", "devin", "comfyui", "duckduckgo-web", "ghe-copilot", "copilot-web",
	}
	for _, slug := range working {
		provider, ok := by[slug]
		if !ok {
			t.Fatalf("missing %s", slug)
		}
		if provider.Protocol == ProtocolUnsupported || provider.Protocol == "" {
			t.Fatalf("%s still unsupported", slug)
		}
	}
	still := []string{
		"puter", "cloudflare-playground", "chipotle", "kiro", "cursor", "sharedchat",
		"copilot-m365-web", "poe-web", "auggie", "openinference",
	}
	for _, slug := range still {
		provider, ok := by[slug]
		if !ok {
			t.Fatalf("missing %s", slug)
		}
		if provider.Protocol != ProtocolUnsupported {
			t.Fatalf("%s protocol = %s", slug, provider.Protocol)
		}
	}
	if by["inflection"].DefaultBaseURL == "" || by["jules"].DefaultBaseURL != "https://jules.googleapis.com" {
		t.Fatal("base urls were not upgraded")
	}
	if len(by["comfyui"].Models) == 0 || len(by["jules"].Models) == 0 {
		t.Fatal("expected a default model")
	}
}
