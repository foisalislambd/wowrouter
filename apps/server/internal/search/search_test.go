package search

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTavily(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[{"title":"Wow","url":"https://example.com","content":"a router"}]}`))
	}))
	defer srv.Close()
	hits, err := Query(t.Context(), Provider{Name: "tavily", APIKey: "k", Base: srv.URL}, "wowrouter", srv.Client())
	if err != nil || len(hits) != 1 || hits[0].Title != "Wow" {
		t.Fatalf("%v %#v", err, hits)
	}
}
