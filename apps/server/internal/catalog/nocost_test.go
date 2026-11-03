package catalog

import "testing"

func TestNoCostProviders(t *testing.T) {
	eqing, ok := BySlug("eqing")
	if !ok || eqing.Protocol != ProtocolOpenAIChat || eqing.DefaultBaseURL != "https://origin.eqing.tech/v1" || len(eqing.Models) != 16 {
		t.Fatalf("eqing %+v ok=%v", eqing.Slug, ok)
	}
	grok, ok := BySlug("g4f-grok")
	if !ok || grok.DefaultBaseURL != "https://g4f.space/api/grok/v1" || len(grok.Models) != 4 {
		t.Fatalf("g4f-grok %+v", grok.DefaultBaseURL)
	}
	local, ok := BySlug("ollamafreeapi")
	if !ok || !local.KeyOptional || local.DefaultBaseURL != "http://127.0.0.1:8000/v1" {
		t.Fatalf("ollamafreeapi %+v", local)
	}
	heck, ok := BySlug("heck")
	if !ok || heck.Protocol != ProtocolUnsupported || !heck.KeyOptional || heck.Models[0].UpstreamID != "deepseek-v3" {
		t.Fatalf("heck %+v", heck)
	}
	vheer, ok := BySlug("vheer")
	if !ok || vheer.Protocol != ProtocolUnsupported || vheer.Models[0].Kind != KindImage {
		t.Fatalf("vheer %+v", vheer)
	}
	anyapi, ok := BySlug("anyapi")
	if !ok || len(anyapi.Models) < 10 {
		t.Fatalf("anyapi models %d", len(anyapi.Models))
	}

	seen := map[string]bool{}
	for _, provider := range All() {
		if seen[provider.Slug] {
			t.Fatalf("duplicate slug %s", provider.Slug)
		}
		seen[provider.Slug] = true
	}
}
