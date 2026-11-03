package wire

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// AnthropicStream turns OpenAI chat SSE into Anthropic message events.
type AnthropicStream struct {
	w        io.Writer
	model    string
	started  bool
	textOpen bool
	closed   bool
	index    int
}

// NewAnthropicStream starts an Anthropic event stream for one model id.
func NewAnthropicStream(w io.Writer, model string) *AnthropicStream {
	return &AnthropicStream{w: w, model: model}
}

// Consume reads one OpenAI SSE payload, or [DONE].
func (a *AnthropicStream) Consume(data string) error {
	data = strings.TrimSpace(data)
	if data == "" {
		return nil
	}
	if data == "[DONE]" {
		return a.finish("end_turn")
	}
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal([]byte(data), &chunk); err != nil {
		return nil
	}
	if err := a.ensureStart(); err != nil {
		return err
	}
	for _, choice := range chunk.Choices {
		if choice.Delta.Content != "" {
			if err := a.text(choice.Delta.Content); err != nil {
				return err
			}
		}
		for _, call := range choice.Delta.ToolCalls {
			if call.Function.Name == "" && call.Function.Arguments == "" {
				continue
			}
			if err := a.tool(call.ID, call.Function.Name, call.Function.Arguments); err != nil {
				return err
			}
		}
		if choice.FinishReason == "tool_calls" {
			return a.finish("tool_use")
		}
	}
	return nil
}

// Finish closes the message if the upstream ended without [DONE].
func (a *AnthropicStream) Finish() error {
	return a.finish("end_turn")
}

func (a *AnthropicStream) ensureStart() error {
	if a.started {
		return nil
	}
	a.started = true
	payload, _ := json.Marshal(map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id": "msg_wowrouter", "type": "message", "role": "assistant", "model": a.model,
			"content": []any{}, "stop_reason": nil, "usage": map[string]int{"input_tokens": 0, "output_tokens": 0},
		},
	})
	return writeSSE(a.w, "message_start", payload)
}

func (a *AnthropicStream) text(text string) error {
	if !a.textOpen {
		payload, _ := json.Marshal(map[string]any{
			"type": "content_block_start", "index": a.index,
			"content_block": map[string]any{"type": "text", "text": ""},
		})
		if err := writeSSE(a.w, "content_block_start", payload); err != nil {
			return err
		}
		a.textOpen = true
	}
	payload, _ := json.Marshal(map[string]any{
		"type": "content_block_delta", "index": a.index,
		"delta": map[string]any{"type": "text_delta", "text": text},
	})
	return writeSSE(a.w, "content_block_delta", payload)
}

func (a *AnthropicStream) tool(id, name, args string) error {
	if err := a.closeBlock(); err != nil {
		return err
	}
	if id == "" {
		id = fmt.Sprintf("toolu_%d", a.index)
	}
	var input any
	if json.Unmarshal([]byte(args), &input) != nil || args == "" {
		input = map[string]any{}
	}
	start, _ := json.Marshal(map[string]any{
		"type": "content_block_start", "index": a.index,
		"content_block": map[string]any{"type": "tool_use", "id": id, "name": name, "input": map[string]any{}},
	})
	if err := writeSSE(a.w, "content_block_start", start); err != nil {
		return err
	}
	partial, _ := json.Marshal(map[string]any{
		"type": "content_block_delta", "index": a.index,
		"delta": map[string]any{"type": "input_json_delta", "partial_json": args},
	})
	if err := writeSSE(a.w, "content_block_delta", partial); err != nil {
		return err
	}
	a.textOpen = true
	return a.closeBlock()
}

func (a *AnthropicStream) closeBlock() error {
	if !a.textOpen {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{"type": "content_block_stop", "index": a.index})
	if err := writeSSE(a.w, "content_block_stop", payload); err != nil {
		return err
	}
	a.textOpen = false
	a.index++
	return nil
}

func (a *AnthropicStream) finish(reason string) error {
	if a.closed {
		return nil
	}
	a.closed = true
	if !a.started {
		if err := a.ensureStart(); err != nil {
			return err
		}
	}
	if err := a.closeBlock(); err != nil {
		return err
	}
	delta, _ := json.Marshal(map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": reason},
		"usage": map[string]int{"output_tokens": 0},
	})
	if err := writeSSE(a.w, "message_delta", delta); err != nil {
		return err
	}
	return writeSSE(a.w, "message_stop", []byte(`{"type":"message_stop"}`))
}

// RelayAnthropic reads an OpenAI event stream and writes Anthropic events.
func RelayAnthropic(dst io.Writer, src io.Reader, model string) error {
	stream := NewAnthropicStream(dst, model)
	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 64*1024), 2<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		if err := stream.Consume(strings.TrimSpace(strings.TrimPrefix(line, "data:"))); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return stream.Finish()
}

// RelayResponses reads an OpenAI event stream and writes Responses events.
func RelayResponses(dst io.Writer, src io.Reader) error {
	created, _ := json.Marshal(map[string]any{"type": "response.created", "response": map[string]any{"id": "resp_wowrouter", "status": "in_progress"}})
	if err := writeSSE(dst, "response.created", created); err != nil {
		return err
	}
	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 64*1024), 2<<20)
	var text strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content == "" {
				continue
			}
			text.WriteString(choice.Delta.Content)
			delta, _ := json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": choice.Delta.Content})
			if err := writeSSE(dst, "response.output_text.delta", delta); err != nil {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	done, _ := json.Marshal(map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id": "resp_wowrouter", "status": "completed",
			"output": []any{map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": text.String()}}}},
		},
	})
	return writeSSE(dst, "response.completed", done)
}

func writeSSE(w io.Writer, event string, payload []byte) error {
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload); err != nil {
		return err
	}
	if flusher, ok := w.(interface{ Flush() }); ok {
		flusher.Flush()
	}
	return nil
}
