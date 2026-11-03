package wire

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"strings"
)

// ProviderSSE wraps an upstream event stream and yields OpenAI chat SSE.
func ProviderSSE(provider string, src io.Reader) io.ReadCloser {
	pr, pw := io.Pipe()
	go func() {
		err := translateSSE(provider, src, pw)
		_ = pw.CloseWithError(err)
	}()
	return pr
}

func translateSSE(provider string, src io.Reader, dst io.Writer) error {
	sc := bufio.NewScanner(src)
	sc.Buffer(make([]byte, 64*1024), 2<<20)
	var event string
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			if line == "" {
				event = ""
			}
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			if _, err := io.WriteString(dst, "data: [DONE]\n\n"); err != nil {
				return err
			}
			continue
		}
		var payload string
		switch provider {
		case "anthropic", "anthropic_compatible":
			payload = anthropicDelta(event, data)
		case "gemini":
			payload = geminiDelta(data)
		default:
			payload = data
		}
		if payload == "" {
			continue
		}
		if _, err := io.WriteString(dst, "data: "+payload+"\n\n"); err != nil {
			return err
		}
	}
	return sc.Err()
}

func anthropicDelta(event, data string) string {
	var body map[string]any
	if json.Unmarshal([]byte(data), &body) != nil {
		return ""
	}
	typ := asString(body["type"])
	if typ == "" {
		typ = event
	}
	switch typ {
	case "content_block_delta":
		delta := asMap(body["delta"])
		switch asString(delta["type"]) {
		case "text_delta":
			return chatDelta(map[string]any{"content": asString(delta["text"])})
		case "thinking_delta":
			return chatDelta(map[string]any{"reasoning_content": asString(delta["thinking"])})
		case "input_json_delta":
			return chatDelta(map[string]any{"tool_calls": []any{map[string]any{
				"index": 0, "function": map[string]any{"arguments": asString(delta["partial_json"])},
			}}})
		}
	case "content_block_start":
		block := asMap(body["content_block"])
		if asString(block["type"]) == "tool_use" {
			return chatDelta(map[string]any{"tool_calls": []any{map[string]any{
				"index": body["index"], "id": asString(block["id"]), "type": "function",
				"function": map[string]any{"name": asString(block["name"]), "arguments": ""},
			}}})
		}
	case "message_delta":
		reason := asString(asMap(body["delta"])["stop_reason"])
		finish := ""
		switch reason {
		case "end_turn":
			finish = "stop"
		case "tool_use":
			finish = "tool_calls"
		case "max_tokens":
			finish = "length"
		}
		if finish != "" {
			raw, _ := json.Marshal(map[string]any{
				"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": finish}},
			})
			return string(raw)
		}
	}
	return ""
}

func geminiDelta(data string) string {
	var body map[string]any
	if json.Unmarshal([]byte(data), &body) != nil {
		return ""
	}
	converted := GeminiToOpenAI(body, "")
	choices := asSlice(converted["choices"])
	if len(choices) == 0 {
		return ""
	}
	msg := asMap(asMap(choices[0])["message"])
	delta := map[string]any{}
	if t := asString(msg["content"]); t != "" {
		delta["content"] = t
	}
	if calls := asSlice(msg["tool_calls"]); len(calls) > 0 {
		delta["tool_calls"] = calls
	}
	if len(delta) == 0 {
		return ""
	}
	return chatDelta(delta)
}

func chatDelta(delta map[string]any) string {
	raw, _ := json.Marshal(map[string]any{
		"object":  "chat.completion.chunk",
		"choices": []any{map[string]any{"index": 0, "delta": delta}},
	})
	return string(raw)
}

// ResponsesSSE writes Responses events for an OpenAI chat SSE stream.
func ResponsesSSE(model string, src io.Reader) io.ReadCloser {
	pr, pw := io.Pipe()
	go func() {
		err := translateResponses(model, src, pw)
		_ = pw.CloseWithError(err)
	}()
	return pr
}

func translateResponses(model string, src io.Reader, dst io.Writer) error {
	sc := bufio.NewScanner(src)
	sc.Buffer(make([]byte, 64*1024), 2<<20)
	started, _ := json.Marshal(map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id": "resp_wowrouter", "object": "response", "status": "in_progress", "model": model,
		},
	})
	if _, err := io.WriteString(dst, "data: "+string(started)+"\n\n"); err != nil {
		return err
	}
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		for _, event := range ChatSSEToResponses(model, data) {
			if _, err := io.WriteString(dst, "data: "+event+"\n\n"); err != nil {
				return err
			}
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	var buf bytes.Buffer
	_ = buf
	return nil
}
