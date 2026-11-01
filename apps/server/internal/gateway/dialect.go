package gateway

import (
	"encoding/json"
	"strings"
)

// ToOpenAI converts an Anthropic, Gemini, or Bedrock request into an OpenAI chat body.
func ToOpenAI(dialect, model string, raw []byte) (map[string]any, error) {
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	switch dialect {
	case "anthropic":
		out := map[string]any{"model": firstNonEmpty(model, asString(body["model"])), "messages": anthropicMessages(body)}
		if body["max_tokens"] != nil {
			out["max_tokens"] = body["max_tokens"]
		}
		if body["stream"] != nil {
			out["stream"] = body["stream"]
		}
		if sys := asString(body["system"]); sys != "" {
			msgs := asSlice(out["messages"])
			out["messages"] = append([]any{map[string]any{"role": "system", "content": sys}}, msgs...)
		}
		return out, nil
	case "gemini":
		out := map[string]any{"model": model, "messages": geminiMessages(body)}
		return out, nil
	case "bedrock":
		out := map[string]any{"model": model, "messages": bedrockMessages(body)}
		return out, nil
	default:
		if asString(body["model"]) == "" && model != "" {
			body["model"] = model
		}
		return body, nil
	}
}

func FromOpenAI(dialect, model string, payload []byte) []byte {
	text := ResponseText(payload)
	switch dialect {
	case "anthropic":
		raw, _ := json.Marshal(map[string]any{
			"id": "msg_wowrouter", "type": "message", "role": "assistant", "model": model,
			"content":     []any{map[string]any{"type": "text", "text": text}},
			"stop_reason": "end_turn",
		})
		return raw
	case "gemini":
		raw, _ := json.Marshal(map[string]any{
			"candidates": []any{map[string]any{
				"content": map[string]any{"role": "model", "parts": []any{map[string]any{"text": text}}},
			}},
		})
		return raw
	case "bedrock":
		raw, _ := json.Marshal(map[string]any{
			"output": map[string]any{"message": map[string]any{
				"role": "assistant", "content": []any{map[string]any{"text": text}},
			}},
			"stopReason": "end_turn",
		})
		return raw
	default:
		return payload
	}
}

func anthropicMessages(body map[string]any) []any {
	var out []any
	for _, item := range asSlice(body["messages"]) {
		m := asMap(item)
		content := m["content"]
		switch c := content.(type) {
		case string:
			out = append(out, map[string]any{"role": asString(m["role"]), "content": c})
		case []any:
			var b strings.Builder
			for _, block := range c {
				bm := asMap(block)
				if asString(bm["type"]) == "text" || bm["text"] != nil {
					b.WriteString(asString(bm["text"]))
				}
			}
			out = append(out, map[string]any{"role": asString(m["role"]), "content": b.String()})
		}
	}
	return out
}

func geminiMessages(body map[string]any) []any {
	var out []any
	for _, item := range asSlice(body["contents"]) {
		m := asMap(item)
		role := asString(m["role"])
		if role == "model" {
			role = "assistant"
		}
		if role == "" {
			role = "user"
		}
		var b strings.Builder
		for _, part := range asSlice(m["parts"]) {
			b.WriteString(asString(asMap(part)["text"]))
		}
		out = append(out, map[string]any{"role": role, "content": b.String()})
	}
	return out
}

func bedrockMessages(body map[string]any) []any {
	var out []any
	if sys := asSlice(body["system"]); len(sys) > 0 {
		var b strings.Builder
		for _, part := range sys {
			b.WriteString(asString(asMap(part)["text"]))
		}
		out = append(out, map[string]any{"role": "system", "content": b.String()})
	}
	for _, item := range asSlice(body["messages"]) {
		m := asMap(item)
		var b strings.Builder
		for _, part := range asSlice(m["content"]) {
			b.WriteString(asString(asMap(part)["text"]))
		}
		out = append(out, map[string]any{"role": asString(m["role"]), "content": b.String()})
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ToUpstream rewrites an OpenAI chat body for a provider type.
func ToUpstream(providerType string, body map[string]any, upstreamModel string) (path string, payload []byte, headers map[string]string) {
	body = cloneMap(body)
	body["model"] = upstreamModel
	headers = map[string]string{"Content-Type": "application/json", "Accept": "application/json"}
	switch providerType {
	case "anthropic", "anthropic_compatible":
		path = "/v1/messages"
		anth := map[string]any{
			"model": upstreamModel, "max_tokens": 1024, "messages": []any{},
		}
		if body["max_tokens"] != nil {
			anth["max_tokens"] = body["max_tokens"]
		}
		var msgs []any
		for _, item := range asSlice(body["messages"]) {
			m := asMap(item)
			if asString(m["role"]) == "system" {
				anth["system"] = asString(m["content"])
				continue
			}
			msgs = append(msgs, map[string]any{"role": asString(m["role"]), "content": asString(m["content"])})
		}
		anth["messages"] = msgs
		payload, _ = json.Marshal(anth)
		headers["anthropic-version"] = "2023-06-01"
		return path, payload, headers
	case "gemini":
		path = "/models/" + upstreamModel + ":generateContent"
		var contents []any
		for _, item := range asSlice(body["messages"]) {
			m := asMap(item)
			role := asString(m["role"])
			if role == "assistant" {
				role = "model"
			}
			contents = append(contents, map[string]any{"role": role, "parts": []any{map[string]any{"text": asString(m["content"])}}})
		}
		payload, _ = json.Marshal(map[string]any{"contents": contents})
		return path, payload, headers
	default:
		path = "/chat/completions"
		payload, _ = json.Marshal(body)
		return path, payload, headers
	}
}
