// Package wire converts chat, Anthropic, Gemini, and Responses bodies
// without dropping tools, cache markers, or thinking blocks.
package wire

import (
	"encoding/json"
	"strings"
)

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(in)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func textOf(content any) string {
	switch c := content.(type) {
	case string:
		return c
	case []any:
		var b strings.Builder
		for _, part := range c {
			m := asMap(part)
			if asString(m["type"]) == "text" || m["text"] != nil {
				b.WriteString(asString(m["text"]))
			}
		}
		return b.String()
	default:
		return ""
	}
}

func jsonRaw(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return "{}"
	default:
		raw, err := json.Marshal(t)
		if err != nil {
			return "{}"
		}
		return string(raw)
	}
}
