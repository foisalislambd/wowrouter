package wire

import "encoding/json"

// ResponsesToOpenAI converts a Responses API body into chat completions.
func ResponsesToOpenAI(body []byte) ([]byte, string, bool, error) {
	var in struct {
		Model        string          `json:"model"`
		Input        json.RawMessage `json:"input"`
		Instructions string          `json:"instructions"`
		Stream       bool            `json:"stream"`
		MaxOutput    int             `json:"max_output_tokens"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, "", false, err
	}
	messages := make([]any, 0, 4)
	if in.Instructions != "" {
		messages = append(messages, map[string]any{"role": "system", "content": in.Instructions})
	}
	messages = append(messages, inputMessages(in.Input)...)
	if len(messages) == 0 {
		messages = append(messages, map[string]any{"role": "user", "content": ""})
	}
	out := map[string]any{"model": in.Model, "messages": messages, "stream": in.Stream}
	if in.MaxOutput > 0 {
		out["max_tokens"] = in.MaxOutput
	}
	raw, err := json.Marshal(out)
	return raw, in.Model, in.Stream, err
}

// OpenAIToResponse wraps assistant text in a Responses object.
func OpenAIToResponse(model, text string, prompt, completion int) ([]byte, error) {
	return json.Marshal(map[string]any{
		"id":     "resp_wowrouter",
		"object": "response",
		"status": "completed",
		"model":  model,
		"output": []any{map[string]any{
			"type": "message",
			"role": "assistant",
			"content": []any{map[string]any{
				"type": "output_text",
				"text": text,
			}},
		}},
		"usage": map[string]int{
			"input_tokens":  prompt,
			"output_tokens": completion,
			"total_tokens":  prompt + completion,
		},
	})
}

func inputMessages(raw json.RawMessage) []any {
	if len(raw) == 0 {
		return nil
	}
	if raw[0] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return nil
		}
		return []any{map[string]any{"role": "user", "content": text}}
	}
	var items []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
		Type    string          `json:"type"`
		Text    string          `json:"text"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return []any{map[string]any{"role": "user", "content": string(raw)}}
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		if item.Type == "input_text" && item.Role == "" {
			out = append(out, map[string]any{"role": "user", "content": item.Text})
			continue
		}
		role := item.Role
		if role == "" {
			role = "user"
		}
		out = append(out, map[string]any{"role": role, "content": contentText(item.Content, item.Text)})
	}
	return out
}

func contentText(raw json.RawMessage, fallback string) string {
	if len(raw) == 0 {
		return fallback
	}
	if raw[0] == '"' {
		var text string
		_ = json.Unmarshal(raw, &text)
		return text
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return fallback
	}
	var b []byte
	for _, block := range blocks {
		b = append(b, block.Text...)
	}
	if len(b) == 0 {
		return fallback
	}
	return string(b)
}
