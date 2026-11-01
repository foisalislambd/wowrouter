// Package catalogdata is a bundled model directory regenerated from models.dev.
//
// The data in models.dev.json is from https://models.dev and is licensed under
// the MIT License. Copyright for that data remains with its authors.
// This file only loads it. It is not derived from Antirion.
package catalogdata

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed models.dev.json
var raw []byte

type Model struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Input   float64 `json:"in,omitempty"`
	Output  float64 `json:"out,omitempty"`
	Context int     `json:"ctx,omitempty"`
	MaxOut  int     `json:"max,omitempty"`
}

type Provider struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	API    string  `json:"api,omitempty"`
	Doc    string  `json:"doc,omitempty"`
	Models []Model `json:"models"`
}

var (
	once      sync.Once
	providers []Provider
	byID      map[string]Provider
)

func load() {
	once.Do(func() {
		_ = json.Unmarshal(raw, &providers)
		byID = make(map[string]Provider, len(providers))
		for _, p := range providers {
			byID[p.ID] = p
		}
	})
}

func Providers() []Provider {
	load()
	return providers
}

func ModelCount() int {
	load()
	n := 0
	for _, p := range providers {
		n += len(p.Models)
	}
	return n
}

func ByID(id string) (Provider, bool) {
	load()
	p, ok := byID[id]
	return p, ok
}

// Dialect is a best-effort protocol for a models.dev provider id.
func Dialect(id string) string {
	switch {
	case strings.Contains(id, "anthropic"):
		return "anthropic_messages"
	case id == "google" || id == "gemini" || strings.Contains(id, "vertex"):
		return "gemini"
	default:
		return "openai_chat"
	}
}
