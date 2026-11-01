package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"wowrouter/server/internal/combo"
	"wowrouter/server/internal/gateway"
)

func (s *Server) gatewayModels(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}
	data := []map[string]any{}
	for _, item := range s.Admin.Store.Resources("models") {
		if item.Spec["enabled"] == false {
			continue
		}
		data = append(data, map[string]any{"id": item.Name, "object": "model", "owned_by": "wowrouter"})
	}
	for _, item := range s.Admin.Store.Resources("deployments") {
		if item.Spec["enabled"] == false {
			continue
		}
		provider := str(item.Spec["provider"])
		upstream := str(item.Spec["model"])
		if provider == "" || upstream == "" {
			continue
		}
		data = append(data, map[string]any{
			"id": provider + "/" + upstream, "object": "model", "owned_by": provider,
		})
	}
	for _, name := range combo.AutoModels() {
		data = append(data, map[string]any{"id": name, "object": "model", "owned_by": "wowrouter"})
	}
	for _, item := range s.Admin.Store.Resources("combos") {
		data = append(data, map[string]any{"id": "combo:" + item.Name, "object": "model", "owned_by": "wowrouter"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data})
}

func (s *Server) gatewayChat(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	raw, err := readBody(r, 20<<20)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	s.dispatch(w, keyID, raw, "openai", "")
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
	if dialect != "openai" && out.Stream == nil && out.Status < 400 && !out.SSE {
		out.Body = gateway.FromOpenAI(dialect, model, out.Body)
	}
	if body["stream"] == true && dialect == "openai" && out.Stream == nil && out.Status < 400 {
		out.SSE = true
	}
	s.writeOutcome(w, call, out)
}

func (s *Server) gatewayImages(w http.ResponseWriter, r *http.Request) {
	s.forwardKind(w, r, "/images/generations")
}

func (s *Server) gatewayVideos(w http.ResponseWriter, r *http.Request) {
	s.forwardKind(w, r, "/videos/generations")
}

func (s *Server) gatewayDecision(w http.ResponseWriter, r *http.Request) {
	s.forwardKind(w, r, "/systemone")
}

func (s *Server) forwardKind(w http.ResponseWriter, r *http.Request, suffix string) {
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
	model := str(body["model"])
	if model == "" {
		writeOpenAIError(w, http.StatusBadRequest, "The model field is required.", "invalid_request_error", "model_required")
		return
	}
	if s.Admin == nil {
		writeOpenAIError(w, http.StatusNotFound, "The model `"+model+"` does not exist.", "invalid_request_error", "model_not_found")
		return
	}
	base, apiKey, upstream, err := s.Admin.Engine.Dial(model)
	if err != nil {
		writeOpenAIError(w, http.StatusNotFound, "The model `"+model+"` does not exist.", "invalid_request_error", "model_not_found")
		return
	}
	body["model"] = upstream
	payload, _ := json.Marshal(body)
	endpoint := gateway.JoinUpstream(base, suffix)
	if err := gateway.SafeHTTPURL(endpoint); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_url")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		writeOpenAIError(w, http.StatusBadGateway, err.Error(), "server_error", "upstream_error")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeOpenAIError(w, http.StatusBadGateway, err.Error(), "server_error", "upstream_error")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 20<<20))
	_ = keyID
}
