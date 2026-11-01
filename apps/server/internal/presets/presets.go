// Package presets is the one-click provider catalog.
//
// The JSON file collects public provider ids, base URLs, and model ids.
// See NOTICE in this directory for the OmniRoute MIT attribution.
package presets

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed presets.json
var raw []byte

// Preset is one provider a person can install without typing a base URL.
type Preset struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	BaseURL string   `json:"base_url"`
	Format  string   `json:"format"`
	Auth    string   `json:"auth"`
	Free    bool     `json:"free"`
	Models  []string `json:"models"`
	Sources []string `json:"sources"`
}

var all []Preset
var byID map[string]Preset

func init() {
	if err := json.Unmarshal(raw, &all); err != nil {
		panic("presets: " + err.Error())
	}
	byID = make(map[string]Preset, len(all))
	for i, p := range all {
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
		all[i] = p
		byID[p.ID] = p
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
