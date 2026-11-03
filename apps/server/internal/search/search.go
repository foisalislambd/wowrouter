// Package search calls a configured web-search provider.
package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Hit is one result in the WowRouter search response.
type Hit struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// Provider is a saved search account.
type Provider struct {
	Name   string
	APIKey string
	Base   string
}

// Query runs one search. The provider name selects the wire format.
func Query(ctx context.Context, p Provider, query string, client *http.Client) ([]Hit, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("query is required")
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	switch strings.ToLower(p.Name) {
	case "brave":
		return brave(ctx, p, query, client)
	case "tavily":
		return tavily(ctx, p, query, client)
	case "searxng":
		return searx(ctx, p, query, client)
	default:
		return nil, fmt.Errorf("unknown search provider %s", p.Name)
	}
}

func brave(ctx context.Context, p Provider, query string, client *http.Client) ([]Hit, error) {
	endpoint := strings.TrimRight(or(p.Base, "https://api.search.brave.com"), "/") + "/res/v1/web/search?q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Subscription-Token", p.APIKey)
	req.Header.Set("Accept", "application/json")
	var body struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := do(client, req, &body); err != nil {
		return nil, err
	}
	var hits []Hit
	for _, row := range body.Web.Results {
		hits = append(hits, Hit{Title: row.Title, URL: row.URL, Snippet: row.Description})
	}
	return hits, nil
}

func tavily(ctx context.Context, p Provider, query string, client *http.Client) ([]Hit, error) {
	raw, _ := json.Marshal(map[string]any{"api_key": p.APIKey, "query": query})
	endpoint := strings.TrimRight(or(p.Base, "https://api.tavily.com"), "/") + "/search"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	var body struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	if err := do(client, req, &body); err != nil {
		return nil, err
	}
	var hits []Hit
	for _, row := range body.Results {
		hits = append(hits, Hit{Title: row.Title, URL: row.URL, Snippet: row.Content})
	}
	return hits, nil
}

func searx(ctx context.Context, p Provider, query string, client *http.Client) ([]Hit, error) {
	if p.Base == "" {
		return nil, fmt.Errorf("searxng needs a base url")
	}
	endpoint := strings.TrimRight(p.Base, "/") + "/search?format=json&q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	var body struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	if err := do(client, req, &body); err != nil {
		return nil, err
	}
	var hits []Hit
	for _, row := range body.Results {
		hits = append(hits, Hit{Title: row.Title, URL: row.URL, Snippet: row.Content})
	}
	return hits, nil
}

func do(client *http.Client, req *http.Request, dest any) error {
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("search returned %d", resp.StatusCode)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return err
	}
	return nil
}

func or(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
