// Package presets is the one-click provider catalog.
//
// The JSON file collects public provider ids, base URLs, and model ids.
// See NOTICE in this directory for the OmniRoute MIT attribution.
package presets

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
)

//go:embed presets.json
var raw []byte

// Preset is one provider a person can install without typing a base URL.
type Preset struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	BaseURL   string   `json:"base_url"`
	Format    string   `json:"format"`
	Auth      string   `json:"auth"`
	Free      bool     `json:"free"`
	Models    []string `json:"models"`
	Sources   []string `json:"sources"`
	Supported bool     `json:"supported"`
	Reason    string   `json:"reason,omitempty"`
	Aliases   []string `json:"aliases,omitempty"`
	Needs     []string `json:"needs,omitempty"`
}

var all []Preset
var byID map[string]Preset

func init() {
	if err := json.Unmarshal(raw, &all); err != nil {
		panic("presets: " + err.Error())
	}
	byID = make(map[string]Preset, len(all))
	for i, p := range all {
		p = normalize(p)
		switch p.ID {
		case "ollama":
			p.BaseURL = "http://127.0.0.1:11434/v1"
			p.Auth = "none"
			p.Free = true
		case "lmstudio":
			p.BaseURL = "http://127.0.0.1:1234/v1"
			p.Auth = "none"
			p.Free = true
		case "llamacpp":
			p.BaseURL = "http://127.0.0.1:8080/v1"
			p.Auth = "none"
			p.Free = true
		}
		all[i] = classify(p)
	}
	attachAliases(all)
	for _, p := range all {
		byID[p.ID] = p
	}
}

func attachAliases(items []Preset) {
	groups := map[string][]int{}
	for i, p := range items {
		if !p.HTTP() || len(p.Needs) > 0 {
			continue
		}
		key := strings.TrimRight(strings.ToLower(p.BaseURL), "/")
		groups[key] = append(groups[key], i)
	}
	for _, idxs := range groups {
		if len(idxs) < 2 {
			continue
		}
		ids := make([]string, len(idxs))
		for j, i := range idxs {
			ids[j] = items[i].ID
		}
		sort.Strings(ids)
		for _, i := range idxs {
			others := make([]string, 0, len(ids)-1)
			for _, id := range ids {
				if id != items[i].ID {
					others = append(others, id)
				}
			}
			items[i].Aliases = others
		}
	}
}

// All returns every preset.
func All() []Preset { return all }

// Count is the catalog size.
func Count() int { return len(all) }

// ByID finds a preset.
func ByID(id string) (Preset, bool) {
	p, ok := byID[strings.TrimSpace(id)]
	return p, ok
}

func normalize(p Preset) Preset {
	p.BaseURL = strings.TrimSpace(p.BaseURL)
	lower := strings.ToLower(p.BaseURL)
	if p.BaseURL != "" && !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		p.BaseURL = ""
		return p
	}
	p.BaseURL = strings.TrimRight(p.BaseURL, "/")
	switch strings.ToLower(p.Format) {
	case "gemini":
		p.BaseURL = trimSuffixFold(p.BaseURL, "/models")
	case "claude", "anthropic":
		p.BaseURL = trimSuffixFold(p.BaseURL, "/v1/messages")
		p.BaseURL = trimSuffixFold(p.BaseURL, "/messages")
	default:
		p.BaseURL = trimSuffixFold(p.BaseURL, "/chat/completions")
		p.BaseURL = trimSuffixFold(p.BaseURL, "/completions")
	}
	return p
}

func trimSuffixFold(s, suffix string) string {
	if strings.HasSuffix(strings.ToLower(s), suffix) {
		return strings.TrimRight(s[:len(s)-len(suffix)], "/")
	}
	return s
}

// HTTP reports whether the preset can be called over HTTP.
func (p Preset) HTTP() bool {
	u := strings.ToLower(p.BaseURL)
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}

// Search filters by id, name, or source. An empty query returns everything.
func Search(query string, freeOnly bool) []Preset {
	q := strings.ToLower(strings.TrimSpace(query))
	out := make([]Preset, 0, len(all))
	for _, p := range all {
		if freeOnly && !p.Free {
			continue
		}
		if q == "" || strings.Contains(strings.ToLower(p.ID+" "+p.Name+" "+strings.Join(p.Sources, " ")), q) {
			out = append(out, p)
		}
	}
	return out
}
