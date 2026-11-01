package gateway

import (
	"errors"
	"regexp"
	"strings"

	"wowrouter/server/internal/compress"
)

var errModelScope = errors.New("this key cannot call that model")

var injectionPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)ignore (all |any )?(previous|prior) instructions`),
	regexp.MustCompile(`(?i)disregard (the |your )?(system|developer)`),
	regexp.MustCompile(`(?i)reveal (the |your )?system prompt`),
	regexp.MustCompile(`(?i)you are now (a |an )?(new|different)`),
}

var (
	emailRE = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	ssnRE   = regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`)
	cardRE  = regexp.MustCompile(`\b(?:\d{4}[ -]){3}\d{4}\b`)
)

func guardPrompt(text string, spec map[string]any) (string, bool) {
	if spec == nil {
		return text, false
	}
	if spec["prompt_injection"] == true {
		for _, re := range injectionPatterns {
			if re.MatchString(text) {
				return text, true
			}
		}
	}
	if spec["pii"] == true {
		text = emailRE.ReplaceAllString(text, "[email]")
		text = ssnRE.ReplaceAllString(text, "[ssn]")
		text = cardRE.ReplaceAllString(text, "[card]")
	}
	return text, false
}

func (e *Engine) scope(call Call) error {
	if e == nil || e.Cat == nil || call.KeyName == "" {
		return nil
	}
	spec, _, ok := e.Cat.Resource("keys", call.KeyName)
	if !ok {
		return nil
	}
	raw := asSlice(spec["models"])
	if len(raw) == 0 {
		return nil
	}
	for _, item := range raw {
		if asString(item) == call.Model {
			return nil
		}
	}
	return errModelScope
}

func (e *Engine) recall(text string) string {
	spec := e.setting("memory")
	if spec == nil || spec["enabled"] != true || e.Cat == nil {
		return ""
	}
	words := memoryWords(text)
	if len(words) == 0 {
		return ""
	}
	type hit struct {
		score int
		text  string
	}
	var best []hit
	for _, note := range e.Cat.Resources("memories") {
		if note.Spec["enabled"] == false {
			continue
		}
		body := asString(note.Spec["text"])
		if body == "" {
			continue
		}
		score := 0
		low := strings.ToLower(body)
		for w := range words {
			if strings.Contains(low, w) {
				score++
			}
		}
		if score == 0 {
			continue
		}
		best = append(best, hit{score: score, text: body})
	}
	if len(best) == 0 {
		return ""
	}
	for i := 0; i < len(best); i++ {
		for j := i + 1; j < len(best); j++ {
			if best[j].score > best[i].score {
				best[i], best[j] = best[j], best[i]
			}
		}
	}
	if len(best) > 3 {
		best = best[:3]
	}
	var b strings.Builder
	b.WriteString("Relevant notes:")
	for _, item := range best {
		b.WriteString("\n- ")
		b.WriteString(item.text)
	}
	return b.String()
}

func memoryWords(text string) map[string]bool {
	out := map[string]bool{}
	for _, part := range strings.Fields(strings.ToLower(text)) {
		part = strings.Trim(part, ".,;:!?\"'")
		if len(part) >= 4 {
			out[part] = true
		}
	}
	return out
}

// redactMessageText rewrites each text part in place. It does not merge turns.
func redactMessageText(body map[string]any) {
	editMessageText(body, func(s string) string {
		s = emailRE.ReplaceAllString(s, "[email]")
		s = ssnRE.ReplaceAllString(s, "[ssn]")
		return cardRE.ReplaceAllString(s, "[card]")
	})
}

// compressMessages shrinks each text part on its own. JSON values are left
// unchanged. The relevance query is the latest user text, not the whole transcript.
func compressMessages(body map[string]any, profile string) {
	query := lastUserText(body)
	editMessageText(body, func(s string) string {
		trimmed := strings.TrimSpace(s)
		if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
			return s
		}
		next, _ := compress.Apply(profile, s, query)
		if next == "" {
			return s
		}
		return next
	})
}

func lastUserText(body map[string]any) string {
	var last string
	for _, item := range asSlice(body["messages"]) {
		m := asMap(item)
		if asString(m["role"]) != "user" {
			continue
		}
		if s, ok := m["content"].(string); ok {
			last = s
		}
	}
	return last
}

func editMessageText(body map[string]any, fn func(string) string) {
	if body == nil || fn == nil {
		return
	}
	msgs := asSlice(body["messages"])
	for i, item := range msgs {
		m := asMap(item)
		switch c := m["content"].(type) {
		case string:
			m["content"] = fn(c)
			msgs[i] = m
		case []any:
			for j, part := range c {
				pm := asMap(part)
				if pm == nil {
					continue
				}
				if t := asString(pm["text"]); t != "" {
					pm["text"] = fn(t)
					c[j] = pm
				}
			}
			m["content"] = c
			msgs[i] = m
		}
	}
	body["messages"] = msgs
}

func prependSystem(body map[string]any, note string) {
	if body == nil || note == "" {
		return
	}
	msgs := asSlice(body["messages"])
	system := map[string]any{"role": "system", "content": note}
	body["messages"] = append([]any{system}, msgs...)
}
