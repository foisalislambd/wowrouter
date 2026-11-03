package wire

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAnthropicToolsRoundTrip(t *testing.T) {
	body := []byte(`{
		"model":"claude-sonnet-4-6",
		"max_tokens":32,
		"system":"be brief",
		"tools":[{"name":"echo","description":"Echo","input_schema":{"type":"object"}}],
		"messages":[
			{"role":"user","content":[{"type":"text","text":"hi"}]},
			{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"echo","input":{"q":"x"}}]},
			{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]}
		]
	}`)
	openaiBody, model, stream, err := AnthropicToOpenAI(body)
	if err != nil || model != "claude-sonnet-4-6" || stream {
		t.Fatal(err, model, stream)
	}
	if !strings.Contains(string(openaiBody), `"role":"tool"`) || !strings.Contains(string(openaiBody), "toolu_1") {
		t.Fatalf("body = %s", openaiBody)
	}
	completion := []byte(`{"choices":[{"finish_reason":"tool_calls","message":{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"echo","arguments":"{\"q\":\"y\"}"}}]}}],"usage":{"prompt_tokens":3,"completion_tokens":4}}`)
	out, err := OpenAIToAnthropic(model, completion)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type string `json:"type"`
			Name string `json:"name"`
		} `json:"content"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.StopReason != "tool_use" || parsed.Content[0].Type != "tool_use" || parsed.Content[0].Name != "echo" {
		t.Fatalf("parsed = %+v", parsed)
	}
}

func TestResponsesStringInput(t *testing.T) {
	body, model, stream, err := ResponsesToOpenAI([]byte(`{"model":"auto","input":"Hello","instructions":"short"}`))
	if err != nil || model != "auto" || stream {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "Hello") || !strings.Contains(string(body), "short") {
		t.Fatalf("body = %s", body)
	}
	out, err := OpenAIToResponse("auto", "Hi", 1, 1)
	if err != nil || !strings.Contains(string(out), "output_text") {
		t.Fatal(err, string(out))
	}
}
