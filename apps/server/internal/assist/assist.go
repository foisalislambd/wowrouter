// Package assist holds optional, local prompt helpers. All of them are off until Settings says otherwise.
package assist

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode"
)

// Light collapses repeated whitespace in text message parts.
// Tool calls, images, and unknown JSON are left alone.
func Light(body []byte) []byte {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return body
	}
	messages, ok := parsed["messages"].([]any)
	if !ok {
		return body
	}
	changed := false
	for _, item := range messages {
		message, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text, ok := message["content"].(string)
		if !ok {
			continue
		}
		next := squeeze(text)
		if next != text {
			message["content"] = next
			changed = true
		}
	}
	if !changed {
		return body
	}
	out, err := json.Marshal(parsed)
	if err != nil {
		return body
	}
	return out
}

func squeeze(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	space := false
	for _, r := range text {
		if unicode.IsSpace(r) {
			if r == '\n' {
				b.WriteByte('\n')
				space = false
				continue
			}
			if !space {
				b.WriteByte(' ')
				space = true
			}
			continue
		}
		space = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// PrependSystem inserts a system message when one should be remembered.
func PrependSystem(body []byte, note string) []byte {
	note = strings.TrimSpace(note)
	if note == "" {
		return body
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return body
	}
	messages, ok := parsed["messages"].([]any)
	if !ok {
		return body
	}
	system := map[string]any{"role": "system", "content": note}
	parsed["messages"] = append([]any{system}, messages...)
	out, err := json.Marshal(parsed)
	if err != nil {
		return body
	}
	return out
}

// StreamAsked reports whether the chat body sets stream true.
func StreamAsked(body []byte) bool {
	var meta struct {
		Stream bool `json:"stream"`
	}
	_ = json.Unmarshal(body, &meta)
	return meta.Stream
}

// SameJSON reports whether two JSON documents match, ignoring object key order.
func SameJSON(a, b []byte) bool {
	var left, right any
	if json.Unmarshal(a, &left) != nil || json.Unmarshal(b, &right) != nil {
		return bytes.Equal(a, b)
	}
	leftRaw, _ := json.Marshal(left)
	rightRaw, _ := json.Marshal(right)
	return bytes.Equal(leftRaw, rightRaw)
}
