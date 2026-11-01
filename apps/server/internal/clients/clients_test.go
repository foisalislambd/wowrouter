package clients

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSnippets(t *testing.T) {
	if len(Names()) != 6 {
		t.Fatal(Names())
	}
	for _, name := range Names() {
		file, body, ok := Snippet(name, "http://127.0.0.1:8787", "sk-test")
		if !ok || file == "" || !strings.Contains(body, "127.0.0.1:8787") {
			t.Fatalf("%s %s %q", name, file, body)
		}
	}
	if _, _, ok := Snippet("nope", "", ""); ok {
		t.Fatal("unknown")
	}
	_, body, ok := Snippet("cursor", "http://127.0.0.1:8787", `sk-"quoted"`)
	if !ok {
		t.Fatal("cursor")
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatal(err)
	}
	if doc["openaiApiKey"] != `sk-"quoted"` || doc["openaiBaseUrl"] != "http://127.0.0.1:8787/v1" {
		t.Fatalf("%#v", doc)
	}
	_, toml, _ := Snippet("codex", `http://host/a"b`, "k")
	if !strings.Contains(toml, `base_url = "http://host/a\"b/v1"`) {
		t.Fatalf("%s", toml)
	}
}
