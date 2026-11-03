package gateway

import (
	"encoding/json"
	"net/url"
	"strings"

	"wowrouter/server/internal/wire"
)

// ToOpenAI converts an Anthropic, Gemini, or Bedrock request into an OpenAI chat body.
func ToOpenAI(dialect, model string, raw []byte) (map[string]any, error) {
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	switch dialect {
	case "anthropic":
		return wire.AnthropicToOpenAIRequest(body, model), nil
	case "gemini":
		return wire.GeminiToOpenAIRequest(body, model), nil
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
		return openAIChatToAnthropicMessage(model, payload, text)
	case "gemini":
		return openAIChatToGemini(text)
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

func openAIChatToAnthropicMessage(model string, payload []byte, text string) []byte {
	var body map[string]any
	_ = json.Unmarshal(payload, &body)
	msg := map[string]any{}
	if choices := asSlice(body["choices"]); len(choices) > 0 {
		msg = asMap(asMap(choices[0])["message"])
	}
	var blocks []any
	if text != "" {
		blocks = append(blocks, map[string]any{"type": "text", "text": text})
	}
	for _, call := range asSlice(msg["tool_calls"]) {
		cm := asMap(call)
		fn := asMap(cm["function"])
		var input any
		if json.Unmarshal([]byte(asString(fn["arguments"])), &input) != nil {
			input = map[string]any{}
		}
		blocks = append(blocks, map[string]any{"type": "tool_use", "id": asString(cm["id"]), "name": asString(fn["name"]), "input": input})
	}
	if len(blocks) == 0 {
		blocks = []any{map[string]any{"type": "text", "text": text}}
	}
	stop := "end_turn"
	if len(asSlice(msg["tool_calls"])) > 0 {
		stop = "tool_use"
	}
	raw, _ := json.Marshal(map[string]any{
		"id": "msg_wowrouter", "type": "message", "role": "assistant", "model": model,
		"content": blocks, "stop_reason": stop,
	})
	return raw
}

func openAIChatToGemini(text string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"candidates": []any{map[string]any{
			"content": map[string]any{"role": "model", "parts": []any{map[string]any{"text": text}}},
		}},
	})
	return raw
}

func urlEscape(s string) string { return url.PathEscape(s) }

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
	keepStream := body["stream"] == true
	body["model"] = upstreamModel
	headers = map[string]string{"Content-Type": "application/json", "Accept": "application/json"}
	if keepStream {
		headers["Accept"] = "text/event-stream, application/json"
	}
	switch providerType {
	case "anthropic", "anthropic_compatible":
		path = "/v1/messages"
		payload, _ = json.Marshal(wire.OpenAIToAnthropic(body, upstreamModel))
		headers["anthropic-version"] = "2023-06-01"
		return path, payload, headers
	case "azure", "azure_openai":
		path = "/openai/deployments/" + urlEscape(upstreamModel) + "/chat/completions?api-version=2024-10-21"
		payload, _ = json.Marshal(body)
		return path, payload, headers
	case "gemini":
		method := "generateContent"
		if keepStream {
			method = "streamGenerateContent"
			path = "/models/" + upstreamModel + ":" + method + "?alt=sse"
		} else {
			path = "/models/" + upstreamModel + ":" + method
		}
		payload, _ = json.Marshal(wire.OpenAIToGemini(body))
		return path, payload, headers
	default:
		path = "/chat/completions"
		payload, _ = json.Marshal(body)
		return path, payload, headers
	}
}
