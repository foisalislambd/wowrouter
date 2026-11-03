package wire

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAnthropicToolsRoundTrip(t *testing.T) {
	body := map[string]any{
		"model": "claude",
		"messages": []any{
			map[string]any{"role": "system", "content": []any{
				map[string]any{"type": "text", "text": "rules", "cache_control": map[string]any{"type": "ephemeral"}},
			}},
			map[string]any{"role": "user", "content": "weather?"},
			map[string]any{"role": "assistant", "content": "", "tool_calls": []any{
				map[string]any{"id": "call_1", "type": "function", "function": map[string]any{"name": "get_weather", "arguments": `{"city":"Paris"}`}},
			}},
			map[string]any{"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
		},
		"tools": []any{map[string]any{"type": "function", "function": map[string]any{
			"name": "get_weather", "parameters": map[string]any{"type": "object"},
		}}},
	}
	anth := OpenAIToAnthropic(body, "claude")
	raw, _ := json.Marshal(anth)
	if !strings.Contains(string(raw), `"cache_control"`) || !strings.Contains(string(raw), `"tool_use"`) || !strings.Contains(string(raw), `"tool_result"`) {
		t.Fatalf("lost structure %s", raw)
	}
	if _, ok := anth["system"].([]any); !ok {
		t.Fatal("cache_control system should stay blocks")
	}
	plain := OpenAIToAnthropic(map[string]any{"messages": []any{
		map[string]any{"role": "system", "content": "a"},
		map[string]any{"role": "system", "content": "b"},
		map[string]any{"role": "user", "content": "hi"},
	}}, "claude")
	if plain["system"] != "a\nb" {
		t.Fatalf("system %#v", plain["system"])
	}
}

func TestAnthropicResponseTools(t *testing.T) {
	in := map[string]any{"content": []any{
		map[string]any{"type": "thinking", "thinking": "hmm"},
		map[string]any{"type": "tool_use", "id": "t1", "name": "echo", "input": map[string]any{"x": 1}},
	}, "stop_reason": "tool_use", "usage": map[string]any{"input_tokens": 3, "output_tokens": 4, "cache_read_input_tokens": 2}}
	out := AnthropicToOpenAI(in, "claude")
	raw, _ := json.Marshal(out)
	if !strings.Contains(string(raw), `"tool_calls"`) || !strings.Contains(string(raw), `"reasoning_content":"hmm"`) {
		t.Fatalf("%s", raw)
	}
	if !strings.Contains(string(raw), `"cached_tokens":2`) {
		t.Fatalf("cache usage %s", raw)
	}
}

func TestResponsesRoundTrip(t *testing.T) {
	chat := ResponsesToChat(map[string]any{
		"model": "gpt", "instructions": "be brief",
		"input": []any{
			map[string]any{"type": "message", "role": "user", "content": []any{map[string]any{"type": "input_text", "text": "hi"}}},
		},
		"tools": []any{map[string]any{"type": "function", "name": "ping", "parameters": map[string]any{"type": "object"}}},
	})
	msgs := asSlice(chat["messages"])
	if len(msgs) != 2 || asString(asMap(msgs[0])["content"]) != "be brief" {
		t.Fatalf("%#v", chat["messages"])
	}
	done := ChatToResponses("gpt", []byte(`{"choices":[{"message":{"role":"assistant","content":"ok","tool_calls":[{"id":"c1","type":"function","function":{"name":"ping","arguments":"{}"}}]}}],"usage":{"prompt_tokens":1,"completion_tokens":2}}`))
	if !strings.Contains(string(done), `"function_call"`) || !strings.Contains(string(done), `"output_text":"ok"`) {
		t.Fatalf("%s", done)
	}
	events := ChatSSEToResponses("gpt", `{"choices":[{"delta":{"content":"yo"}}]}`)
	if len(events) != 1 || !strings.Contains(events[0], `"yo"`) {
		t.Fatalf("%v", events)
	}
}

func TestGeminiTools(t *testing.T) {
	body := OpenAIToGemini(map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "go"},
			map[string]any{"role": "assistant", "tool_calls": []any{
				map[string]any{"function": map[string]any{"name": "add", "arguments": `{"n":1}`}},
			}},
		},
		"tools": []any{map[string]any{"type": "function", "function": map[string]any{"name": "add"}}},
	})
	raw, _ := json.Marshal(body)
	if !strings.Contains(string(raw), "functionCall") || !strings.Contains(string(raw), "functionDeclarations") {
		t.Fatalf("%s", raw)
	}
	back := GeminiToOpenAI(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{
		map[string]any{"functionCall": map[string]any{"name": "add", "args": map[string]any{"n": 1}}},
	}}}}}, "gem")
	choice := asMap(asSlice(back["choices"])[0])
	msg := asMap(choice["message"])
	if asSlice(msg["tool_calls"]) == nil {
		t.Fatalf("%#v", back)
	}
}
