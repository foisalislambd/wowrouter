package wire

import "encoding/json"

// OpenAIToGemini rewrites an OpenAI chat body into a Gemini generateContent body.
func OpenAIToGemini(body map[string]any) map[string]any {
	var contents []any
	var system string
	for _, item := range asSlice(body["messages"]) {
		m := asMap(item)
		role := asString(m["role"])
		if role == "system" || role == "developer" {
			if system != "" {
				system += "\n"
			}
			system += textOf(m["content"])
			continue
		}
		if role == "tool" {
			contents = append(contents, map[string]any{
				"role": "user",
				"parts": []any{map[string]any{"functionResponse": map[string]any{
					"name":     asString(m["name"]),
					"response": map[string]any{"content": textOf(m["content"])},
				}}},
			})
			continue
		}
		gRole := "user"
		if role == "assistant" {
			gRole = "model"
		}
		var parts []any
		if text := textOf(m["content"]); text != "" {
			parts = append(parts, map[string]any{"text": text})
		}
		for _, call := range asSlice(m["tool_calls"]) {
			cm := asMap(call)
			fn := asMap(cm["function"])
			var args any
			raw := jsonRaw(fn["arguments"])
			if json.Unmarshal([]byte(raw), &args) != nil {
				args = map[string]any{}
			}
			parts = append(parts, map[string]any{"functionCall": map[string]any{
				"name": asString(fn["name"]), "args": args,
			}})
		}
		if len(parts) == 0 {
			parts = []any{map[string]any{"text": ""}}
		}
		contents = append(contents, map[string]any{"role": gRole, "parts": parts})
	}
	out := map[string]any{"contents": contents}
	if system != "" {
		out["systemInstruction"] = map[string]any{"parts": []any{map[string]any{"text": system}}}
	}
	if tools := openAIToolsToGemini(body["tools"]); len(tools) > 0 {
		out["tools"] = []any{map[string]any{"functionDeclarations": tools}}
	}
	return out
}

func openAIToolsToGemini(v any) []any {
	var out []any
	for _, item := range asSlice(v) {
		m := asMap(item)
		fn := asMap(m["function"])
		if asString(fn["name"]) == "" {
			continue
		}
		decl := map[string]any{"name": asString(fn["name"])}
		if d := asString(fn["description"]); d != "" {
			decl["description"] = d
		}
		if fn["parameters"] != nil {
			decl["parameters"] = fn["parameters"]
		}
		out = append(out, decl)
	}
	return out
}

// GeminiToOpenAI rewrites a generateContent response into an OpenAI chat completion.
func GeminiToOpenAI(body map[string]any, model string) map[string]any {
	var text string
	var calls []any
	n := 0
	for _, cand := range asSlice(body["candidates"]) {
		content := asMap(asMap(cand)["content"])
		for _, part := range asSlice(content["parts"]) {
			pm := asMap(part)
			if t := asString(pm["text"]); t != "" {
				text += t
			}
			if fc := asMap(pm["functionCall"]); asString(fc["name"]) != "" {
				args, _ := json.Marshal(fc["args"])
				n++
				calls = append(calls, map[string]any{
					"id": "call_" + itoa(n), "type": "function",
					"function": map[string]any{"name": asString(fc["name"]), "arguments": string(args)},
				})
			}
		}
	}
	msg := map[string]any{"role": "assistant", "content": text}
	finish := "stop"
	if len(calls) > 0 {
		msg["tool_calls"] = calls
		finish = "tool_calls"
	}
	usage := asMap(body["usageMetadata"])
	return map[string]any{
		"id": "chatcmpl-wowrouter", "object": "chat.completion", "model": model,
		"choices": []any{map[string]any{"index": 0, "message": msg, "finish_reason": finish}},
		"usage": map[string]any{
			"prompt_tokens":     usage["promptTokenCount"],
			"completion_tokens": usage["candidatesTokenCount"],
		},
	}
}

// GeminiToOpenAIRequest converts a generateContent request into OpenAI chat.
func GeminiToOpenAIRequest(body map[string]any, model string) map[string]any {
	var msgs []any
	if sys := asMap(body["systemInstruction"]); len(sys) > 0 {
		msgs = append(msgs, map[string]any{"role": "system", "content": textOf(partsText(sys["parts"]))})
	}
	for _, item := range asSlice(body["contents"]) {
		m := asMap(item)
		role := asString(m["role"])
		if role == "model" {
			role = "assistant"
		}
		if role == "" {
			role = "user"
		}
		var text string
		var calls []any
		for _, part := range asSlice(m["parts"]) {
			pm := asMap(part)
			text += asString(pm["text"])
			if fc := asMap(pm["functionCall"]); asString(fc["name"]) != "" {
				args, _ := json.Marshal(fc["args"])
				calls = append(calls, map[string]any{
					"id": "call", "type": "function",
					"function": map[string]any{"name": asString(fc["name"]), "arguments": string(args)},
				})
			}
		}
		msg := map[string]any{"role": role, "content": text}
		if len(calls) > 0 {
			msg["tool_calls"] = calls
		}
		msgs = append(msgs, msg)
	}
	return map[string]any{"model": model, "messages": msgs}
}

func partsText(v any) any {
	var b string
	for _, part := range asSlice(v) {
		b += asString(asMap(part)["text"])
	}
	return b
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [16]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
