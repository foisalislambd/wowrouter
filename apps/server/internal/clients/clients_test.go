package clients

import "strings"
import "testing"

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
}
