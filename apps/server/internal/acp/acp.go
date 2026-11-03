// Package acp speaks a small Agent Client Protocol over stdio.
// A prompt is one chat completion against WOWROUTER_URL.
package acp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Run reads JSON-RPC lines until stdin closes.
func Run(in io.Reader, out io.Writer, base, token string) error {
	if base == "" {
		base = "http://127.0.0.1:8787"
	}
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	enc := json.NewEncoder(out)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var req map[string]any
		if json.Unmarshal([]byte(line), &req) != nil {
			_ = enc.Encode(errResult(nil, -32700, "invalid json"))
			continue
		}
		_ = enc.Encode(handle(req, base, token))
	}
	return sc.Err()
}

func handle(req map[string]any, base, token string) map[string]any {
	id := req["id"]
	switch str(req["method"]) {
	case "initialize":
		return ok(id, map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": false}})
	case "session/new":
		return ok(id, map[string]any{"sessionId": "wowrouter"})
	case "session/prompt":
		params, _ := req["params"].(map[string]any)
		prompt := str(params["prompt"])
		model := str(params["model"])
		if model == "" {
			model = os.Getenv("WOWROUTER_MODEL")
		}
		if model == "" {
			model = "auto/coding"
		}
		text, err := chat(base, token, model, prompt)
		if err != nil {
			return errResult(id, -32000, err.Error())
		}
		return ok(id, map[string]any{"stopReason": "end_turn", "content": []any{map[string]any{"type": "text", "text": text}}})
	default:
		return errResult(id, -32601, "method not found")
	}
}

func chat(base, token, model, prompt string) (string, error) {
	raw, _ := json.Marshal(map[string]any{
		"model": model, "messages": []any{map[string]any{"role": "user", "content": prompt}},
	})
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(base, "/")+"/v1/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	var parsed map[string]any
	_ = json.Unmarshal(body, &parsed)
	choices, _ := parsed["choices"].([]any)
	if len(choices) == 0 {
		return string(body), nil
	}
	msg, _ := choices[0].(map[string]any)["message"].(map[string]any)
	if text, ok := msg["content"].(string); ok {
		return text, nil
	}
	return string(body), nil
}

func ok(id, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func errResult(id any, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}}
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
