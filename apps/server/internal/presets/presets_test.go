package presets

import (
	"strings"
	"testing"
)

func TestCatalogHasLocalAndRemote(t *testing.T) {
	if Count() < 400 {
		t.Fatalf("catalog %d", Count())
	}
	ollama, ok := ByID("ollama")
	if !ok || ollama.BaseURL != "http://127.0.0.1:11434/v1" || !ollama.Free {
		t.Fatalf("%+v %v", ollama, ok)
	}
	lm, ok := ByID("lmstudio")
	if !ok || lm.BaseURL == "" {
		t.Fatal("lmstudio")
	}
	if _, ok := ByID("openai"); !ok {
		t.Fatal("openai")
	}
	gem, ok := ByID("gemini")
	if !ok || gem.BaseURL != "https://generativelanguage.googleapis.com/v1beta" || gem.Auth != "query" {
		t.Fatalf("gemini %+v", gem)
	}
	ant, ok := ByID("anthropic")
	if !ok || ant.BaseURL != "https://api.anthropic.com" || ant.Auth != "x-api-key" {
		t.Fatalf("anthropic %+v", ant)
	}
	if adobe, ok := ByID("adobe-firefly"); !ok || adobe.HTTP() {
		t.Fatalf("non-http preset %+v", adobe)
	}
	for _, p := range All() {
		if strings.Contains(p.BaseURL, " ") || strings.Contains(p.BaseURL, "/chat/completions") {
			t.Fatalf("bad base %s %s", p.ID, p.BaseURL)
		}
	}
	free := Search("", true)
	if len(free) < 20 {
		t.Fatalf("free %d", len(free))
	}
}
