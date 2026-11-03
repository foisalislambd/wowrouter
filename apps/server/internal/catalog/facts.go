package catalog

import (
	"strings"
	"sync"
)

// ModelFacts is context and price known from the built-in catalog.
type ModelFacts struct {
	ContextWindow       int
	MaxOutput           int
	InputUSDPerMillion  float64
	OutputUSDPerMillion float64
}

var (
	factsOnce sync.Once
	factsByID map[string]ModelFacts
)

// LookupFacts finds catalog context and price for an upstream id.
// A provider prefix is ignored when the id itself is not in the catalog.
func LookupFacts(id string) ModelFacts {
	factsOnce.Do(indexFacts)
	key := strings.ToLower(strings.TrimSpace(id))
	if facts, ok := factsByID[key]; ok {
		return facts
	}
	if i := strings.LastIndex(key, "/"); i >= 0 {
		if facts, ok := factsByID[key[i+1:]]; ok {
			return facts
		}
	}
	return ModelFacts{}
}

func indexFacts() {
	factsByID = map[string]ModelFacts{}
	for _, provider := range All() {
		for _, model := range provider.Models {
			facts := ModelFacts{
				ContextWindow:       model.ContextWindow,
				MaxOutput:           model.MaxOutputTokens,
				InputUSDPerMillion:  model.InputUSDPerMillion,
				OutputUSDPerMillion: model.OutputUSDPerMillion,
			}
			if facts == (ModelFacts{}) {
				continue
			}
			key := strings.ToLower(model.UpstreamID)
			factsByID[key] = mergeFacts(factsByID[key], facts)
			if i := strings.LastIndex(key, "/"); i >= 0 {
				short := key[i+1:]
				factsByID[short] = mergeFacts(factsByID[short], facts)
			}
		}
	}
}

func mergeFacts(current, next ModelFacts) ModelFacts {
	if next.ContextWindow > current.ContextWindow {
		current.ContextWindow = next.ContextWindow
	}
	if next.MaxOutput > current.MaxOutput {
		current.MaxOutput = next.MaxOutput
	}
	if next.InputUSDPerMillion > 0 {
		current.InputUSDPerMillion = next.InputUSDPerMillion
	}
	if next.OutputUSDPerMillion > 0 {
		current.OutputUSDPerMillion = next.OutputUSDPerMillion
	}
	return current
}
