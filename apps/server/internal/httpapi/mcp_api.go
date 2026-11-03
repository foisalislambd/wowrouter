package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
)

func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	var body struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, mcpError(nil, -32700, "parse error"))
		return
	}
	switch body.Method {
	case "initialize":
		writeJSON(w, http.StatusOK, mcpResult(body.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]string{"name": "wowrouter", "version": "1"},
		}))
	case "tools/list":
		writeJSON(w, http.StatusOK, mcpResult(body.ID, map[string]any{"tools": mcpTools()}))
	case "tools/call":
		s.mcpCall(w, r, keyID, body.ID, body.Params)
	case "notifications/initialized", "ping":
		writeJSON(w, http.StatusOK, mcpResult(body.ID, map[string]any{}))
	default:
		writeJSON(w, http.StatusOK, mcpError(body.ID, -32601, "method not found"))
	}
}

func (s *Server) mcpCall(w http.ResponseWriter, r *http.Request, keyID string, id any, params json.RawMessage) {
	var call struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	_ = json.Unmarshal(params, &call)
	switch call.Name {
	case "list_models":
		items, err := s.Store.ListActiveModels()
		if err != nil {
			writeJSON(w, http.StatusOK, mcpError(id, -32000, err.Error()))
			return
		}
		names := make([]string, 0, len(items))
		for _, item := range items {
			names = append(names, item.ID)
		}
		writeJSON(w, http.StatusOK, mcpResult(id, mcpText(strings.Join(names, "\n"))))
	case "complete_chat":
		model, _ := call.Arguments["model"].(string)
		if model == "" {
			model = "auto"
		}
		prompt, _ := call.Arguments["prompt"].(string)
		payload := map[string]any{"model": model, "messages": []any{map[string]any{"role": "user", "content": prompt}}}
		if messages, ok := call.Arguments["messages"]; ok {
			payload["messages"] = messages
		}
		raw, _ := json.Marshal(payload)
		rec := newCapture()
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(raw))
		if err != nil {
			writeJSON(w, http.StatusOK, mcpError(id, -32000, err.Error()))
			return
		}
		s.proxyChat(rec, req, "mcp", keyID)
		writeJSON(w, http.StatusOK, mcpResult(id, mcpText(rec.buf.String())))
	default:
		writeJSON(w, http.StatusOK, mcpError(id, -32602, "unknown tool"))
	}
}

func (s *Server) agentCard(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":               "WowRouter",
		"description":        "Local router for chat models already turned on in the panel.",
		"url":                "http://" + s.Addr + "/a2a",
		"version":            "1",
		"capabilities":       map[string]any{"streaming": false},
		"defaultInputModes":  []string{"text"},
		"defaultOutputModes": []string{"text"},
		"skills": []map[string]string{{
			"id": "complete_chat", "name": "Complete chat", "description": "Send a prompt through a WowRouter model such as auto.",
		}},
	})
}

func (s *Server) a2a(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	var body struct {
		Method string `json:"method"`
		Params struct {
			Message struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"message"`
		} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error", "invalid_body")
		return
	}
	var text strings.Builder
	for _, part := range body.Params.Message.Parts {
		text.WriteString(part.Text)
	}
	raw, _ := json.Marshal(map[string]any{
		"model":    "auto",
		"messages": []any{map[string]any{"role": "user", "content": text.String()}},
	})
	rec := newCapture()
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "/v1/chat/completions", bytes.NewReader(raw))
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	s.proxyChat(rec, req, "a2a", keyID)
	writeJSON(w, http.StatusOK, map[string]any{
		"message": map[string]any{
			"role":  "agent",
			"parts": []any{map[string]string{"text": assistantText(rec.buf.Bytes())}},
		},
	})
}

func mcpTools() []map[string]any {
	return []map[string]any{
		{"name": "list_models", "description": "List model ids that are turned on.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "complete_chat", "description": "Run one chat completion through the router.", "inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"model":  map[string]string{"type": "string"},
				"prompt": map[string]string{"type": "string"},
			},
		}},
	}
}

func mcpResult(id, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func mcpError(id any, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}}
}

func mcpText(text string) map[string]any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}}
}
