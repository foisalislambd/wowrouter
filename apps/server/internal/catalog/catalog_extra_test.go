package catalog

import "testing"

func TestExtraProvidersDoNotDuplicate(t *testing.T) {
	seen := map[string]int{}
	for _, provider := range All() {
		seen[provider.Slug]++
	}
	for slug, n := range seen {
		if n != 1 {
			t.Fatalf("slug %s appears %d times", slug, n)
		}
	}
	if _, ok := BySlug("llama-cpp"); !ok {
		t.Fatal("expected llama-cpp in the catalog")
	}
	if _, ok := BySlug("kimi"); !ok {
		t.Fatal("expected kimi in the catalog")
	}
}
