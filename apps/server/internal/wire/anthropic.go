package wire

import "encoding/json"

// OpenAIToAnthropic rewrites an OpenAI chat body into an Anthropic Messages body.
// Plain system strings stay a single string so existing callers keep the same JSON.
// Tools, tool calls, tool results, and cache_control are preserved as blocks.
func OpenAIToAnthropic(body map[string]any, model string) map[string]any {
	out := map[string]any{
		"model":      model,
		"max_tokens": 1024,
		"messages":   []any{},
	}
	if body["max_tokens"] != nil {
		out["max_tokens"] = body["max_tokens"]
	}
	if body["temperature"] != nil {
		out["temperature"] = body["temperature"]
	}
	if body["top_p"] != nil {
		out["top_p"] = body["top_p"]
	}
	if body["stream"] == true {
		out["stream"] = true
	}
	if stop := body["stop"]; stop != nil {
		out["stop_sequences"] = stop
	}
	var systemParts []any
	var systemPlain []string
	richSystem := false
	var msgs []any
	for _, item := range asSlice(body["messages"]) {
		m := asMap(item)
		role := asString(m["role"])
		switch role {
		case "system", "developer":
			parts, plain, rich := systemBlocks(m["content"])
			if rich {
				richSystem = true
			}
			systemParts = append(systemParts, parts...)
			if plain != "" {
				systemPlain = append(systemPlain, plain)
			}
		case "tool":
			msgs = append(msgs, map[string]any{
				"role": "user",
				"content": []any{map[string]any{
					"type":        "tool_result",
					"tool_use_id": asString(m["tool_call_id"]),
					"content":     textOf(m["content"]),
				}},
			})
		default:
			msgs = append(msgs, openAIMessageToAnthropic(m))
		}
	}
	if richSystem {
		out["system"] = systemParts
	} else if len(systemPlain) > 0 {
		out["system"] = joinLines(systemPlain)
	}
	if len(msgs) == 0 {
		msgs = []any{map[string]any{"role": "user", "content": ""}}
	}
	out["messages"] = msgs
	if tools := openAIToolsToAnthropic(body["tools"]); len(tools) > 0 {
		out["tools"] = tools
	}
	if tc := body["tool_choice"]; tc != nil {
		out["tool_choice"] = anthropicToolChoice(tc)
	}
	return out
}

func joinLines(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += "\n"
		}
		out += p
	}
	return out
}

func systemBlocks(content any) (blocks []any, plain string, rich bool) {
	switch c := content.(type) {
	case string:
		return []any{map[string]any{"type": "text", "text": c}}, c, false
	case []any:
		var b []any
		var plainParts []string
		for _, part := range c {
			m := asMap(part)
			block := map[string]any{"type": "text", "text": asString(m["text"])}
			if cc := m["cache_control"]; cc != nil {
				block["cache_control"] = cc
				rich = true
			}
			b = append(b, block)
			plainParts = append(plainParts, asString(m["text"]))
		}
		return b, joinLines(plainParts), rich
	default:
		return nil, "", false
	}
}

func openAIMessageToAnthropic(m map[string]any) map[string]any {
	role := asString(m["role"])
	if role != "assistant" {
		role = "user"
	}
	var blocks []any
	switch c := m["content"].(type) {
	case string:
		if c != "" || len(asSlice(m["tool_calls"])) == 0 {
			blocks = append(blocks, map[string]any{"type": "text", "text": c})
		}
	case []any:
		for _, part := range c {
			pm := asMap(part)
			switch asString(pm["type"]) {
			case "text", "":
				block := map[string]any{"type": "text", "text": asString(pm["text"])}
				if cc := pm["cache_control"]; cc != nil {
					block["cache_control"] = cc
				}
				blocks = append(blocks, block)
			case "image_url":
				url := asString(asMap(pm["image_url"])["url"])
				if url != "" {
					blocks = append(blocks, map[string]any{
						"type":   "image",
						"source": map[string]any{"type": "url", "url": url},
					})
				}
			}
		}
	}
	for _, call := range asSlice(m["tool_calls"]) {
		cm := asMap(call)
		fn := asMap(cm["function"])
		var args any
		raw := jsonRaw(fn["arguments"])
		if json.Unmarshal([]byte(raw), &args) != nil {
			args = map[string]any{}
		}
		blocks = append(blocks, map[string]any{
			"type":  "tool_use",
			"id":    asString(cm["id"]),
			"name":  asString(fn["name"]),
			"input": args,
		})
	}
	if len(blocks) == 1 && asString(asMap(blocks[0])["type"]) == "text" && asMap(blocks[0])["cache_control"] == nil {
		return map[string]any{"role": role, "content": asString(asMap(blocks[0])["text"])}
	}
	if blocks == nil {
		blocks = []any{map[string]any{"type": "text", "text": ""}}
	}
	return map[string]any{"role": role, "content": blocks}
}

func openAIToolsToAnthropic(v any) []any {
	var out []any
	for _, item := range asSlice(v) {
		m := asMap(item)
		fn := asMap(m["function"])
		if asString(m["type"]) == "function" || fn["name"] != nil {
			schema := fn["parameters"]
			if schema == nil {
				schema = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			tool := map[string]any{
				"name":         asString(fn["name"]),
				"input_schema": schema,
			}
			if d := asString(fn["description"]); d != "" {
				tool["description"] = d
			}
			if cc := m["cache_control"]; cc != nil {
				tool["cache_control"] = cc
			}
			out = append(out, tool)
		}
	}
	return out
}

func anthropicToolChoice(v any) any {
	switch t := v.(type) {
	case string:
		switch t {
		case "none":
			return map[string]any{"type": "none"}
		case "required":
			return map[string]any{"type": "any"}
		default:
			return map[string]any{"type": "auto"}
		}
	default:
		m := asMap(v)
		if asString(m["type"]) == "function" {
			return map[string]any{"type": "tool", "name": asString(asMap(m["function"])["name"])}
		}
		return map[string]any{"type": "auto"}
	}
}

// AnthropicToOpenAI rewrites a Messages response into an OpenAI chat completion.
func AnthropicToOpenAI(body map[string]any, model string) map[string]any {
	var text string
	var reasoning string
	var calls []any
	for _, block := range asSlice(body["content"]) {
		m := asMap(block)
		switch asString(m["type"]) {
		case "thinking":
			reasoning += asString(m["thinking"])
		case "tool_use":
			args, _ := json.Marshal(m["input"])
			calls = append(calls, map[string]any{
				"id": asString(m["id"]), "type": "function",
				"function": map[string]any{"name": asString(m["name"]), "arguments": string(args)},
			})
		default:
			text += asString(m["text"])
		}
	}
	msg := map[string]any{"role": "assistant", "content": text}
	if reasoning != "" {
		msg["reasoning_content"] = reasoning
	}
	finish := "stop"
	if len(calls) > 0 {
		msg["tool_calls"] = calls
		finish = "tool_calls"
	}
	switch asString(body["stop_reason"]) {
	case "max_tokens":
		finish = "length"
	case "tool_use":
		finish = "tool_calls"
	}
	usage := asMap(body["usage"])
	outUsage := map[string]any{
		"prompt_tokens":     usage["input_tokens"],
		"completion_tokens": usage["output_tokens"],
	}
	if usage["cache_read_input_tokens"] != nil {
		outUsage["prompt_tokens_details"] = map[string]any{"cached_tokens": usage["cache_read_input_tokens"]}
	}
	if model == "" {
		model = asString(body["model"])
	}
	return map[string]any{
		"id": "chatcmpl-wowrouter", "object": "chat.completion", "model": model,
		"choices": []any{map[string]any{"index": 0, "message": msg, "finish_reason": finish}},
		"usage":   outUsage,
	}
}

// AnthropicToOpenAIRequest is the inbound /v1/messages body as an OpenAI chat body.
func AnthropicToOpenAIRequest(body map[string]any, model string) map[string]any {
	out := map[string]any{"model": first(model, asString(body["model"])), "messages": []any{}}
	if body["max_tokens"] != nil {
		out["max_tokens"] = body["max_tokens"]
	}
	if body["stream"] != nil {
		out["stream"] = body["stream"]
	}
	if body["temperature"] != nil {
		out["temperature"] = body["temperature"]
	}
	var msgs []any
	if sys := body["system"]; sys != nil {
		msgs = append(msgs, map[string]any{"role": "system", "content": systemContent(sys)})
	}
	for _, item := range asSlice(body["messages"]) {
		m := asMap(item)
		msgs = append(msgs, anthropicMessageToOpenAI(m))
	}
	out["messages"] = msgs
	if tools := anthropicToolsToOpenAI(body["tools"]); len(tools) > 0 {
		out["tools"] = tools
	}
	return out
}

func first(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func systemContent(sys any) any {
	switch s := sys.(type) {
	case string:
		return s
	case []any:
		var parts []any
		for _, item := range s {
			m := asMap(item)
			part := map[string]any{"type": "text", "text": asString(m["text"])}
			if cc := m["cache_control"]; cc != nil {
				part["cache_control"] = cc
			}
			parts = append(parts, part)
		}
		return parts
	default:
		return textOf(sys)
	}
}

func anthropicMessageToOpenAI(m map[string]any) map[string]any {
	role := asString(m["role"])
	switch c := m["content"].(type) {
	case string:
		return map[string]any{"role": role, "content": c}
	case []any:
		var textParts []any
		var calls []any
		var toolMsgs []map[string]any
		for _, block := range c {
			bm := asMap(block)
			switch asString(bm["type"]) {
			case "tool_use":
				args, _ := json.Marshal(bm["input"])
				calls = append(calls, map[string]any{
					"id": asString(bm["id"]), "type": "function",
					"function": map[string]any{"name": asString(bm["name"]), "arguments": string(args)},
				})
			case "tool_result":
				toolMsgs = append(toolMsgs, map[string]any{
					"role": "tool", "tool_call_id": asString(bm["tool_use_id"]), "content": textOf(bm["content"]),
				})
			case "thinking":
				textParts = append(textParts, map[string]any{"type": "text", "text": asString(bm["thinking"])})
			default:
				part := map[string]any{"type": "text", "text": asString(bm["text"])}
				if cc := bm["cache_control"]; cc != nil {
					part["cache_control"] = cc
				}
				textParts = append(textParts, part)
			}
		}
		if len(toolMsgs) == 1 && len(textParts) == 0 && len(calls) == 0 {
			return toolMsgs[0]
		}
		msg := map[string]any{"role": role}
		if len(textParts) == 1 && asMap(textParts[0])["cache_control"] == nil {
			msg["content"] = asString(asMap(textParts[0])["text"])
		} else if len(textParts) > 0 {
			msg["content"] = textParts
		} else {
			msg["content"] = ""
		}
		if len(calls) > 0 {
			msg["tool_calls"] = calls
			msg["role"] = "assistant"
		}
		return msg
	default:
		return map[string]any{"role": role, "content": textOf(m["content"])}
	}
}

func anthropicToolsToOpenAI(v any) []any {
	var out []any
	for _, item := range asSlice(v) {
		m := asMap(item)
		schema := m["input_schema"]
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		tool := map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        asString(m["name"]),
				"description": asString(m["description"]),
				"parameters":  schema,
			},
		}
		if cc := m["cache_control"]; cc != nil {
			tool["cache_control"] = cc
		}
		out = append(out, tool)
	}
	return out
}
