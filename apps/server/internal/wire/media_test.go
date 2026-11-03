package wire

import (
	"encoding/json"
	"testing"
)

func TestGeminiEmbeddingRoundTrip(t *testing.T) {
	body, restore := PrepareEmbeddings("gemini", map[string]any{"model": "embed", "input": "hello"})
	if body["model"] != "models/embed" || restore == nil {
		t.Fatalf("%#v", body)
	}
	out := restore([]byte(`{"embedding":{"values":[0.1,0.2]}}`))
	var parsed map[string]any
	if json.Unmarshal(out, &parsed) != nil {
		t.Fatal(string(out))
	}
	if parsed["object"] != "list" {
		t.Fatalf("%s", out)
	}
}
