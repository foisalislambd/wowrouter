package presets

import "testing"

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
	free := Search("", true)
	if len(free) < 20 {
		t.Fatalf("free %d", len(free))
	}
}
