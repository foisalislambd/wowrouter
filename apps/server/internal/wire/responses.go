package wire

import (
	"encoding/json"
	"strings"
)

// ResponsesToChat converts an OpenAI Responses request into a chat completion request.
func ResponsesToChat(body map[string]any) map[string]any {
	out := cloneMap(body)
	delete(out, "input")
	delete(out, "instructions")
	var msgs []any
	if inst := asString(body["instructions"]); inst != "" {
		msgs = append(msgs, map[string]any{"role": "system", "content": inst})
	}
	switch input := body["input"].(type) {
	case string:
		msgs = append(msgs, map[string]any{"role": "user", "content": input})
	case []any:
		msgs = append(msgs, responsesInput(input)...)
	}
	if len(msgs) == 0 {
		msgs = []any{map[string]any{"role": "user", "content": ""}}
	}
	out["messages"] = msgs
	if tools := responsesTools(body["tools"]); tools != nil {
		out["tools"] = tools
	}
	return out
}

func responsesInput(items []any) []any {
	var msgs []any
	for _, item := range items {
		switch m := item.(type) {
		case string:
			msgs = append(msgs, map[string]any{"role": "user", "content": m})
		case map[string]any:
			msgs = append(msgs, responseItemToMessage(m))
		}
	}
	return msgs
}

func responseItemToMessage(m map[string]any) map[string]any {
	typ := asString(m["type"])
	role := asString(m["role"])
	switch typ {
	case "function_call":
		return map[string]any{
			"role": "assistant", "content": "",
			"tool_calls": []any{map[string]any{
				"id": asString(m["call_id"]), "type": "function",
				"function": map[string]any{"name": asString(m["name"]), "arguments": jsonRaw(m["arguments"])},
			}},
		}
	case "function_call_output":
		return map[string]any{"role": "tool", "tool_call_id": asString(m["call_id"]), "content": textOf(m["output"])}
	case "message", "":
		if role == "" {
			role = "user"
		}
		return map[string]any{"role": role, "content": responseContent(m["content"])}
	default:
		if role == "" {
			role = "user"
		}
		return map[string]any{"role": role, "content": textOf(m["content"])}
	}
}

func responseContent(v any) any {
	switch c := v.(type) {
	case string:
		return c
	case []any:
		var parts []any
		for _, item := range c {
			m := asMap(item)
			switch asString(m["type"]) {
			case "input_text", "output_text", "text", "":
				parts = append(parts, map[string]any{"type": "text", "text": asString(m["text"])})
			case "input_image":
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": asString(m["image_url"])}})
			default:
				if t := asString(m["text"]); t != "" {
					parts = append(parts, map[string]any{"type": "text", "text": t})
				}
			}
		}
		if len(parts) == 1 {
			return asString(asMap(parts[0])["text"])
		}
		return parts
	default:
		return textOf(v)
	}
}

func responsesTools(v any) []any {
	var out []any
	for _, item := range asSlice(v) {
		m := asMap(item)
		if asString(m["type"]) == "function" || m["name"] != nil {
			name := asString(m["name"])
			if name == "" {
				name = asString(asMap(m["function"])["name"])
			}
			params := m["parameters"]
			if params == nil {
				params = asMap(m["function"])["parameters"]
			}
			out = append(out, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name": name, "description": asString(m["description"]), "parameters": params,
				},
			})
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// ChatToResponses converts an OpenAI chat completion into a Responses object.
func ChatToResponses(model string, chat []byte) []byte {
	var body map[string]any
	if json.Unmarshal(chat, &body) != nil {
		body = map[string]any{}
	}
	choice := map[string]any{}
	if choices := asSlice(body["choices"]); len(choices) > 0 {
		choice = asMap(choices[0])
	}
	msg := asMap(choice["message"])
	text := textOf(msg["content"])
	var output []any
	if text != "" || len(asSlice(msg["tool_calls"])) == 0 {
		output = append(output, map[string]any{
			"type": "message", "role": "assistant", "status": "completed",
			"content": []any{map[string]any{"type": "output_text", "text": text}},
		})
	}
	for _, call := range asSlice(msg["tool_calls"]) {
		cm := asMap(call)
		fn := asMap(cm["function"])
		output = append(output, map[string]any{
			"type": "function_call", "call_id": asString(cm["id"]), "name": asString(fn["name"]),
			"arguments": jsonRaw(fn["arguments"]), "status": "completed",
		})
	}
	status := "completed"
	if asString(choice["finish_reason"]) == "length" {
		status = "incomplete"
	}
	raw, _ := json.Marshal(map[string]any{
		"id": "resp_wowrouter", "object": "response", "status": status, "model": model,
		"output": output, "output_text": text,
		"usage": usageToResponses(asMap(body["usage"])),
	})
	return raw
}

func usageToResponses(u map[string]any) map[string]any {
	in := u["prompt_tokens"]
	out := u["completion_tokens"]
	cached := asMap(u["prompt_tokens_details"])["cached_tokens"]
	return map[string]any{
		"input_tokens": in, "output_tokens": out,
		"input_tokens_details": map[string]any{"cached_tokens": cached},
	}
}

// ChatSSEToResponses turns one OpenAI chat SSE payload into Responses SSE events.
// An empty slice means the line carried no output.
func ChatSSEToResponses(model, data string) []string {
	data = strings.TrimSpace(data)
	if data == "" || data == "[DONE]" {
		if data == "[DONE]" {
			raw, _ := json.Marshal(map[string]any{
				"type": "response.completed",
				"response": map[string]any{
					"id": "resp_wowrouter", "object": "response", "status": "completed", "model": model,
				},
			})
			return []string{string(raw)}
		}
		return nil
	}
	var chunk map[string]any
	if json.Unmarshal([]byte(data), &chunk) != nil {
		return nil
	}
	choices := asSlice(chunk["choices"])
	if len(choices) == 0 {
		return nil
	}
	delta := asMap(asMap(choices[0])["delta"])
	var events []string
	if text := asString(delta["content"]); text != "" {
		raw, _ := json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": text})
		events = append(events, string(raw))
	}
	for _, call := range asSlice(delta["tool_calls"]) {
		cm := asMap(call)
		fn := asMap(cm["function"])
		if asString(fn["arguments"]) == "" && asString(fn["name"]) == "" {
			continue
		}
		raw, _ := json.Marshal(map[string]any{
			"type":    "response.function_call_arguments.delta",
			"call_id": asString(cm["id"]), "name": asString(fn["name"]), "delta": asString(fn["arguments"]),
		})
		events = append(events, string(raw))
	}
	return events
}
