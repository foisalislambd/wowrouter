package wire

import (
	"encoding/json"
	"strings"
)

// AnthropicToOpenAI converts a Messages API body into a chat-completions body.
// Tool use and tool results are mapped so Claude Code can keep a tool loop.
func AnthropicToOpenAI(body []byte) ([]byte, string, bool, error) {
	var in struct {
		Model     string          `json:"model"`
		System    json.RawMessage `json:"system"`
		Messages  []anthropicMsg  `json:"messages"`
		MaxTokens int             `json:"max_tokens"`
		Stream    bool            `json:"stream"`
		Tools     []anthropicTool `json:"tools"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, "", false, err
	}
	messages := make([]any, 0, len(in.Messages)+1)
	if system := systemText(in.System); system != "" {
		messages = append(messages, map[string]any{"role": "system", "content": system})
	}
	for _, message := range in.Messages {
		messages = append(messages, message.openai()...)
	}
	out := map[string]any{
		"model":    in.Model,
		"messages": messages,
		"stream":   in.Stream,
	}
	if in.MaxTokens > 0 {
		out["max_tokens"] = in.MaxTokens
	}
	if len(in.Tools) > 0 {
		tools := make([]any, 0, len(in.Tools))
		for _, tool := range in.Tools {
			params := tool.InputSchema
			if len(params) == 0 {
				params = json.RawMessage(`{"type":"object"}`)
			}
			tools = append(tools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        tool.Name,
					"description": tool.Description,
					"parameters":  json.RawMessage(params),
				},
			})
		}
		out["tools"] = tools
	}
	raw, err := json.Marshal(out)
	return raw, in.Model, in.Stream, err
}

// OpenAIToAnthropic converts a chat completion into a Messages response.
func OpenAIToAnthropic(model string, completion []byte) ([]byte, error) {
	var in struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(completion, &in); err != nil {
		return nil, err
	}
	text := ""
	var tools []map[string]any
	stop := "end_turn"
	if len(in.Choices) > 0 {
		text = in.Choices[0].Message.Content
		if in.Choices[0].FinishReason == "tool_calls" {
			stop = "tool_use"
		}
		for _, call := range in.Choices[0].Message.ToolCalls {
			var input any
			if err := json.Unmarshal([]byte(call.Function.Arguments), &input); err != nil || input == nil {
				input = map[string]any{}
			}
			tools = append(tools, map[string]any{
				"type":  "tool_use",
				"id":    call.ID,
				"name":  call.Function.Name,
				"input": input,
			})
		}
	}
	content := make([]any, 0, 2)
	if text != "" {
		content = append(content, map[string]any{"type": "text", "text": text})
	}
	for _, tool := range tools {
		content = append(content, tool)
	}
	if len(content) == 0 {
		content = append(content, map[string]any{"type": "text", "text": ""})
	}
	return json.Marshal(map[string]any{
		"id":            "msg_wowrouter",
		"type":          "message",
		"role":          "assistant",
		"model":         model,
		"stop_reason":   stop,
		"stop_sequence": nil,
		"content":       content,
		"usage": map[string]int{
			"input_tokens":  in.Usage.PromptTokens,
			"output_tokens": in.Usage.CompletionTokens,
		},
	})
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicMsg struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

func (m anthropicMsg) openai() []any {
	if len(m.Content) == 0 {
		return []any{map[string]any{"role": m.Role, "content": ""}}
	}
	if m.Content[0] == '"' {
		var text string
		if err := json.Unmarshal(m.Content, &text); err != nil {
			return nil
		}
		return []any{map[string]any{"role": m.Role, "content": text}}
	}
	var blocks []struct {
		Type      string          `json:"type"`
		Text      string          `json:"text"`
		ID        string          `json:"id"`
		Name      string          `json:"name"`
		Input     json.RawMessage `json:"input"`
		ToolUseID string          `json:"tool_use_id"`
		Content   json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(m.Content, &blocks); err != nil {
		return []any{map[string]any{"role": m.Role, "content": string(m.Content)}}
	}
	var text strings.Builder
	var calls []any
	var results []any
	for _, block := range blocks {
		switch block.Type {
		case "text", "":
			text.WriteString(block.Text)
		case "tool_use":
			args := string(block.Input)
			if args == "" {
				args = "{}"
			}
			calls = append(calls, map[string]any{
				"id":   block.ID,
				"type": "function",
				"function": map[string]any{
					"name":      block.Name,
					"arguments": args,
				},
			})
		case "tool_result":
			results = append(results, map[string]any{
				"role":         "tool",
				"tool_call_id": block.ToolUseID,
				"content":      rawText(block.Content),
			})
		}
	}
	var out []any
	if text.Len() > 0 || len(calls) > 0 {
		msg := map[string]any{"role": m.Role, "content": text.String()}
		if len(calls) > 0 {
			msg["tool_calls"] = calls
		}
		out = append(out, msg)
	}
	out = append(out, results...)
	if len(out) == 0 {
		out = append(out, map[string]any{"role": m.Role, "content": ""})
	}
	return out
}

func systemText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var text string
		_ = json.Unmarshal(raw, &text)
		return text
	}
	var blocks []struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return ""
	}
	var b strings.Builder
	for _, block := range blocks {
		b.WriteString(block.Text)
	}
	return b.String()
}

func rawText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var text string
		_ = json.Unmarshal(raw, &text)
		return text
	}
	var blocks []struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &blocks); err == nil && len(blocks) > 0 {
		var b strings.Builder
		for _, block := range blocks {
			b.WriteString(block.Text)
		}
		return b.String()
	}
	return string(raw)
}
