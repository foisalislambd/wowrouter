package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/oauth"
	"wowrouter/server/internal/wire"
)

func (s *Server) gatewayResponses(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	raw, err := readBody(r, 20<<20)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil || body == nil {
		writeOpenAIError(w, http.StatusBadRequest, "The request body must be JSON.", "invalid_request_error", "invalid_body")
		return
	}
	chat := wire.ResponsesToChat(body)
	model := str(chat["model"])
	if model == "" {
		model = str(body["model"])
		chat["model"] = model
	}
	stream := chat["stream"] == true
	if s.Admin == nil {
		writeOpenAIError(w, http.StatusNotFound, "The model is not configured.", "invalid_request_error", "model_not_found")
		return
	}
	call := s.callFromKey(keyID, model, chat, "responses")
	out := s.Admin.Engine.Handle(call)
	if out.Status >= 400 {
		s.writeOutcome(w, call, out)
		return
	}
	if stream && out.Stream != nil {
		defer out.Stream.Close()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(out.Status)
		translated := wire.ResponsesSSE(model, out.Stream)
		defer translated.Close()
		_, _ = io.Copy(w, translated)
		return
	}
	if out.Stream != nil {
		defer out.Stream.Close()
		buf, _ := io.ReadAll(io.LimitReader(out.Stream, 8<<20))
		out.Body = buf
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(out.Status)
	_, _ = w.Write(wire.ChatToResponses(model, out.Body))
}

func (s *Server) gatewayEmbeddings(w http.ResponseWriter, r *http.Request) {
	s.forwardKind(w, r, "/embeddings")
}

func (s *Server) gatewayAudio(w http.ResponseWriter, r *http.Request) {
	suffix := "/audio/speech"
	if strings.HasSuffix(r.URL.Path, "/transcriptions") {
		suffix = "/audio/transcriptions"
	} else if strings.HasSuffix(r.URL.Path, "/translations") {
		suffix = "/audio/translations"
	}
	s.forwardKind(w, r, suffix)
}

func (s *Server) gatewayModerations(w http.ResponseWriter, r *http.Request) {
	s.forwardKind(w, r, "/moderations")
}

func (s *Server) gatewaySearch(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	raw, err := readBody(r, 1<<20)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		writeOpenAIError(w, http.StatusBadRequest, "The request body must be JSON.", "invalid_request_error", "invalid_body")
		return
	}
	query := str(body["query"])
	model := str(body["model"])
	if query == "" || model == "" {
		writeOpenAIError(w, http.StatusBadRequest, "query and model are required.", "invalid_request_error", "invalid_body")
		return
	}
	chat := map[string]any{
		"model": model,
		"messages": []any{
			map[string]any{"role": "system", "content": "Answer as a search result. Return a short factual passage."},
			map[string]any{"role": "user", "content": query},
		},
	}
	encoded, _ := json.Marshal(chat)
	s.dispatch(w, keyID, encoded, "search", model)
}

var (
	batchMu sync.Mutex
	batches = map[string]map[string]any{}
)

func (s *Server) gatewayBatches(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/batches"), "/")
		batchMu.Lock()
		item := batches[id]
		batchMu.Unlock()
		if id == "" || id == "batches" {
			var items []any
			batchMu.Lock()
			for _, item := range batches {
				items = append(items, item)
			}
			batchMu.Unlock()
			writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": items})
			return
		}
		if item == nil {
			writeOpenAIError(w, http.StatusNotFound, "No batch with that id.", "invalid_request_error", "not_found")
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	raw, err := readBody(r, 8<<20)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		writeOpenAIError(w, http.StatusBadRequest, "The request body must be JSON.", "invalid_request_error", "invalid_body")
		return
	}
	lines, _ := body["requests"].([]any)
	id := "batch_" + time.Now().UTC().Format("20060102150405")
	var output []any
	for _, line := range lines {
		row, _ := line.(map[string]any)
		model := str(row["model"])
		chat := map[string]any{"model": model, "messages": row["messages"]}
		encoded, _ := json.Marshal(chat)
		rec := httptestResponse(s, keyID, encoded, model)
		output = append(output, map[string]any{"custom_id": row["custom_id"], "response": json.RawMessage(rec)})
	}
	item := map[string]any{
		"id": id, "object": "batch", "status": "completed", "endpoint": "/v1/chat/completions",
		"request_counts": map[string]any{"total": len(lines), "completed": len(lines), "failed": 0},
		"output":         output,
	}
	batchMu.Lock()
	batches[id] = item
	batchMu.Unlock()
	writeJSON(w, http.StatusOK, item)
}

func httptestResponse(s *Server, keyID string, raw []byte, model string) []byte {
	if s.Admin == nil {
		return []byte(`{"error":{"message":"gateway is not configured"}}`)
	}
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	call := s.callFromKey(keyID, model, body, "openai")
	out := s.Admin.Engine.Handle(call)
	if len(out.Body) == 0 {
		return []byte(`{}`)
	}
	return out.Body
}

func (s *Server) oauthStart(w http.ResponseWriter, r *http.Request) {
	if s.Admin == nil || !s.Admin.Authorized(r) {
		writeAPIError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	id := r.PathValue("provider")
	authURL, state, err := oauth.Start(id)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authorization_url": authURL, "state": state})
}

func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("provider")
	if errText := r.URL.Query().Get("error"); errText != "" {
		writeAPIError(w, http.StatusBadRequest, errText)
		return
	}
	result, err := oauth.Exchange(r.Context(), id, r.URL.Query().Get("state"), r.URL.Query().Get("code"), http.DefaultClient)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.Admin != nil {
		_ = s.Admin.Store.SaveOAuth(id, result.AccessToken, result.RefreshToken, result.ExpiresAt)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "provider": id, "expires_at": result.ExpiresAt})
}

// remember buffers a short idempotency window for identical chat retries.
type remember struct {
	mu    sync.Mutex
	items map[string]memo
}

type memo struct {
	status int
	body   []byte
	until  time.Time
}

type capture struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (c *capture) WriteHeader(status int) {
	c.status = status
	c.ResponseWriter.WriteHeader(status)
}

func (c *capture) Write(p []byte) (int, error) {
	_, _ = c.buf.Write(p)
	return c.ResponseWriter.Write(p)
}

var idem = remember{items: map[string]memo{}}

func (m *remember) get(key string) (int, []byte, bool) {
	if key == "" {
		return 0, nil, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.items[key]
	if !ok || time.Now().After(item.until) {
		delete(m.items, key)
		return 0, nil, false
	}
	return item.status, append([]byte(nil), item.body...), true
}

func (m *remember) put(key string, status int, body []byte) {
	if key == "" || status >= 500 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items[key] = memo{status: status, body: append([]byte(nil), body...), until: time.Now().Add(5 * time.Minute)}
}

func (s *Server) remembered(key string) (int, []byte, bool) {
	if status, body, ok := idem.get(key); ok {
		return status, body, true
	}
	if s.Admin == nil || s.Admin.Store == nil {
		return 0, nil, false
	}
	status, body, ok := s.Admin.Store.Idempotent(key)
	if ok {
		idem.put(key, status, body)
	}
	return status, body, ok
}

func (s *Server) remember(key string, status int, body []byte) {
	idem.put(key, status, body)
	if s.Admin != nil && s.Admin.Store != nil {
		s.Admin.Store.SaveIdempotent(key, status, body)
	}
}

func (s *Server) dispatch(w http.ResponseWriter, keyID string, raw []byte, dialect, model string) {
	if s.Admin == nil {
		writeOpenAIError(w, http.StatusNotFound, "The model is not configured.", "invalid_request_error", "model_not_found")
		return
	}
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil || body == nil {
		writeOpenAIError(w, http.StatusBadRequest, "The request body must be JSON.", "invalid_request_error", "invalid_body")
		return
	}
	if model == "" {
		model = str(body["model"])
	}
	if strings.TrimSpace(model) == "" {
		writeOpenAIError(w, http.StatusBadRequest, "The model field is required.", "invalid_request_error", "model_required")
		return
	}
	body["model"] = model
	call := s.callFromKey(keyID, model, body, dialect)
	out := s.Admin.Engine.Handle(call)
	if dialect != "openai" && dialect != "responses" && dialect != "search" && out.Stream == nil && out.Status < 400 && !out.SSE {
		out.Body = gateway.FromOpenAI(dialect, model, out.Body)
	}
	if body["stream"] == true && (dialect == "openai" || dialect == "search") && out.Stream == nil && out.Status < 400 {
		out.SSE = true
	}
	s.writeOutcome(w, call, out)
}
