// Package assist holds optional, local prompt helpers. All of them are off until Settings says otherwise.
package assist

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode"
)

// Modes the router can apply locally. Neural compressors are not bundled.
func KnownMode(mode string) bool {
	switch strings.TrimSpace(mode) {
	case "", "off", "light", "caveman", "dedup", "headroom", "rtk", "terse", "ultra":
		return true
	default:
		return false
	}
}

// Apply rewrites text message parts. Tool calls, images, and unknown JSON stay as they are.
func Apply(body []byte, mode string) []byte {
	mode = strings.TrimSpace(mode)
	if mode == "" || mode == "off" {
		return body
	}
	return rewriteMessages(body, mode)
}

// Rewrite is the plain-text form of a compression mode, used by the preview page.
func Rewrite(text, mode string) string {
	switch strings.TrimSpace(mode) {
	case "", "off":
		return text
	case "light":
		return squeeze(text)
	case "caveman":
		return caveman(squeeze(text))
	case "dedup":
		return dedupLines(text)
	case "headroom":
		return clipRunes(squeeze(text), 4000)
	case "rtk":
		return dropShell(squeeze(text))
	case "terse":
		return clipRunes(caveman(squeeze(text)), 2000)
	case "ultra":
		return clipRunes(caveman(squeeze(dedupLines(text))), 800)
	default:
		return text
	}
}

// Light collapses repeated whitespace in text message parts.
// Tool calls, images, and unknown JSON are left alone.
func Light(body []byte) []byte {
	return Apply(body, "light")
}

func rewriteMessages(body []byte, mode string) []byte {
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
		next := Rewrite(text, mode)
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

func caveman(text string) string {
	drop := map[string]bool{
		"a": true, "an": true, "the": true, "really": true, "just": true, "please": true,
		"very": true, "basically": true, "actually": true, "that": true, "this": true,
	}
	parts := strings.Fields(text)
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		word := strings.Trim(strings.ToLower(part), ".,;:!?")
		if drop[word] {
			continue
		}
		kept = append(kept, part)
	}
	return strings.Join(kept, " ")
}

func dedupLines(text string) string {
	seen := map[string]bool{}
	var b strings.Builder
	for _, line := range strings.Split(text, "\n") {
		key := strings.TrimSpace(line)
		if key != "" && seen[key] {
			continue
		}
		if key != "" {
			seen[key] = true
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(line)
	}
	return strings.TrimSpace(b.String())
}

func dropShell(text string) string {
	var b strings.Builder
	for _, line := range strings.Split(text, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "$ ") || strings.HasPrefix(trim, "> ") || strings.HasPrefix(trim, "# ") {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(line)
	}
	return strings.TrimSpace(b.String())
}

func clipRunes(text string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return strings.TrimSpace(string(runes[:max])) + "…"
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
