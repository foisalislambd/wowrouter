package httpapi

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"

	"wowrouter/server/internal/combo"
	"wowrouter/server/internal/presets"
)

func (s *Server) allowIP(r *http.Request) bool {
	if s.Admin == nil {
		return true
	}
	res, err := s.Admin.Store.Get("settings", "network")
	if err != nil {
		return true
	}
	raw, _ := res.Spec["allow"].([]any)
	if len(raw) == 0 {
		return true
	}
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = h
	}
	ip := net.ParseIP(host)
	for _, item := range raw {
		rule := strings.TrimSpace(str(item))
		if rule == "" || rule == host || rule == "*" {
			if rule != "" {
				return true
			}
			continue
		}
		if strings.Contains(rule, "/") && ip != nil {
			if _, network, err := net.ParseCIDR(rule); err == nil && network.Contains(ip) {
				return true
			}
		}
	}
	return false
}

func (s *Server) agentCard(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":        "WowRouter",
		"description": "Local LLM gateway",
		"url":         "http://" + s.Addr + "/a2a/gateway",
		"version":     "1.1.8",
		"capabilities": map[string]any{
			"streaming": true,
		},
		"skills": []any{
			map[string]any{"id": "chat", "name": "Chat", "description": "OpenAI, Anthropic, and Gemini chat through the gateway"},
		},
		"defaultInputModes":  []string{"text/plain", "application/json"},
		"defaultOutputModes": []string{"text/plain", "application/json"},
	})
}

func (s *Server) bridge(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		writeJSON(w, http.StatusOK, map[string]any{"bridge": "websocket", "path": "/v1/bridge"})
		return
	}
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		if _, ok := s.authorize(w, r); !ok {
			return
		}
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "websocket is not available")
		return
	}
	conn, bufrw, err := hj.Hijack()
	if err != nil {
		return
	}
	defer conn.Close()
	key := r.Header.Get("Sec-WebSocket-Key")
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	_, _ = bufrw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n")
	_ = bufrw.Flush()
	payload := []byte(`{"type":"ready","service":"wowrouter"}`)
	frame := []byte{0x81, byte(len(payload))}
	frame = append(frame, payload...)
	_, _ = conn.Write(frame)
}

func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, rpcErr(nil, -32700, "read error"))
		return
	}
	var req map[string]any
	if json.Unmarshal(raw, &req) != nil {
		writeJSON(w, http.StatusBadRequest, rpcErr(nil, -32700, "invalid json"))
		return
	}
	id := req["id"]
	method := str(req["method"])
	switch method {
	case "initialize":
		writeJSON(w, http.StatusOK, rpcOK(id, map[string]any{
			"protocolVersion": "2024-11-05",
			"serverInfo":      map[string]any{"name": "wowrouter", "version": "1.1.8"},
			"capabilities":    map[string]any{"tools": map[string]any{}},
		}))
	case "tools/list":
		writeJSON(w, http.StatusOK, rpcOK(id, map[string]any{"tools": mcpTools()}))
	case "tools/call":
		params, _ := req["params"].(map[string]any)
		name := str(params["name"])
		writeJSON(w, http.StatusOK, rpcOK(id, map[string]any{"content": []any{
			map[string]any{"type": "text", "text": s.mcpCall(name)},
		}}))
	case "ping":
		writeJSON(w, http.StatusOK, rpcOK(id, map[string]any{}))
	default:
		writeJSON(w, http.StatusOK, rpcErr(id, -32601, "method not found"))
	}
}

func mcpTools() []any {
	names := []struct{ name, desc string }{
		{"health", "Gateway health"},
		{"list_providers", "Configured providers"},
		{"list_models", "Configured models and deployments"},
		{"list_combos", "Routing combos"},
		{"list_presets", "How many provider presets are available"},
		{"list_strategies", "Combo routing strategies and auto models"},
	}
	var out []any
	for _, tool := range names {
		out = append(out, map[string]any{
			"name": tool.name, "description": tool.desc,
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		})
	}
	return out
}

func (s *Server) mcpCall(name string) string {
	switch name {
	case "health":
		return `{"status":"ok"}`
	case "list_presets":
		return `{"count":` + itoa(presets.Count()) + `}`
	case "list_strategies":
		raw, _ := json.Marshal(map[string]any{"strategies": combo.Strategies(), "auto_models": combo.AutoModels()})
		return string(raw)
	case "list_providers", "list_models", "list_combos":
		if s.Admin == nil {
			return "[]"
		}
		col := map[string]string{"list_providers": "providers", "list_models": "models", "list_combos": "combos"}[name]
		var names []string
		for _, item := range s.Admin.Store.Resources(col) {
			names = append(names, item.Name)
		}
		raw, _ := json.Marshal(names)
		return string(raw)
	default:
		return `{"error":"unknown tool"}`
	}
}

func rpcOK(id any, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcErr(id any, code int, message string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
