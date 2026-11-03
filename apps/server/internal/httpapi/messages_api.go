package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"airoute/server/internal/catalog"
	"airoute/server/internal/provider/adapt"
	"airoute/server/internal/provider/openai"
	"airoute/server/internal/store"
	"airoute/server/internal/wire"
)

func (s *Server) gatewayMessages(w http.ResponseWriter, r *http.Request) {
	s.gatewayTranslated(w, r, "anthropic")
}

func (s *Server) countTokens(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	body, err := readBody(r, 2<<20)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error", "invalid_body")
		return
	}
	n := utf8.RuneCount(body) / 4
	if n < 1 {
		n = 1
	}
	writeJSON(w, http.StatusOK, map[string]int{"input_tokens": n})
}

func (s *Server) gatewayResponses(w http.ResponseWriter, r *http.Request) {
	s.gatewayTranslated(w, r, "responses")
}

func (s *Server) gatewayTranslated(w http.ResponseWriter, r *http.Request, format string) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	started := time.Now()
	raw, err := readBody(r, 20<<20)
	if err != nil {
		s.failChat(w, "gateway", keyID, "", http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return
	}
	var chatBody []byte
	var model string
	var stream bool
	if format == "anthropic" {
		chatBody, model, stream, err = wire.AnthropicToOpenAI(raw)
	} else {
		chatBody, model, stream, err = wire.ResponsesToOpenAI(raw)
	}
	if err != nil || strings.TrimSpace(model) == "" {
		s.failChat(w, "gateway", keyID, model, http.StatusBadRequest, "invalid_request_error", "model_required", "The model field is required.", started)
		return
	}
	plan, err := s.resolveAsked(model)
	if errors.Is(err, store.ErrNotFound) {
		s.failChat(w, "gateway", keyID, model, http.StatusNotFound, "invalid_request_error", "model_not_found", "The model `"+model+"` does not exist.", started)
		return
	}
	if errors.Is(err, store.ErrFallbackEmpty) || errors.Is(err, store.ErrNoAutoCandidates) {
		s.failChat(w, "gateway", keyID, model, http.StatusBadRequest, "invalid_request_error", "model_not_found", err.Error(), started)
		return
	}
	if err != nil {
		s.failChat(w, "gateway", keyID, model, http.StatusInternalServerError, "server_error", "internal_error", err.Error(), started)
		return
	}
	if err := s.Store.RejectIfOverBudget(keyID); errors.Is(err, store.ErrBudget) {
		s.failChat(w, "gateway", keyID, model, http.StatusTooManyRequests, "insufficient_quota", "budget_exceeded", err.Error(), started)
		return
	} else if err != nil {
		s.failChat(w, "gateway", keyID, model, http.StatusInternalServerError, "server_error", "internal_error", err.Error(), started)
		return
	}
	chatBody = s.decorateChat(r, chatBody)
	r = r.WithContext(withDecision(r.Context(), routeDecision{Asked: plan.Asked, Strategy: plan.Strategy}))
	if hit := s.cacheLookup(r, plan.Asked, chatBody); hit != nil && !stream {
		s.writeTranslated(w, format, plan.Asked, hit, false)
		return
	}
	routes, err := s.expandRoutes(plan.Routes)
	if err != nil {
		s.failChat(w, "gateway", keyID, model, http.StatusInternalServerError, "server_error", "internal_error", err.Error(), started)
		return
	}
	for i, route := range routes {
		more := i < len(routes)-1
		route.APIKey = providerCredential(route.Model.ProviderSlug, route.APIKey)
		if !routeReady(route) {
			if more {
				continue
			}
			s.failChat(w, "gateway", keyID, route.Model.ID, http.StatusNotFound, "invalid_request_error", "model_not_found", routeBlockedMessage(model, route), started)
			return
		}
		if s.writeTranslatedRoute(w, r, keyID, format, raw, chatBody, route, stream, more, started) {
			return
		}
	}
	s.failChat(w, "gateway", keyID, model, http.StatusBadGateway, "server_error", "upstream_error", "No model in this route accepted the request.", started)
}

func (s *Server) resolveAsked(model string) (store.Plan, error) {
	plan, err := s.Store.ResolvePlan(model)
	if errors.Is(err, store.ErrNotFound) && !strings.Contains(model, "/") {
		if alt, err2 := s.Store.ResolvePlan("anthropic/" + model); err2 == nil {
			return alt, nil
		}
	}
	return plan, err
}

func (s *Server) writeTranslatedRoute(w http.ResponseWriter, r *http.Request, keyID, format string, raw, chatBody []byte, route store.Route, stream, more bool, started time.Time) bool {
	if route.Protocol == catalog.ProtocolAnthropic && format == "anthropic" {
		return s.passAnthropic(w, r, keyID, raw, route, stream, more, started)
	}
	if route.Protocol != catalog.ProtocolOpenAIChat {
		return s.bufferTranslated(w, r, keyID, format, chatBody, route, stream, more, started)
	}
	upstream, _, err := openai.RewriteChatModel(chatBody, route.Model.UpstreamID)
	if err != nil {
		if more {
			return false
		}
		s.failChat(w, "gateway", keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return true
	}
	header := http.Header{}
	openai.ApplyCredential(header, route.APIKey, catalog.UsesSessionCookie(route.Model.ProviderSlug))
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json, text/event-stream")
	endpoint := strings.TrimRight(route.BaseURL, "/") + "/chat/completions"
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, endpoint, upstream, header)
	if err != nil {
		_ = s.addRouteLog(r, store.LogInput{Source: "gateway", RouterKeyID: keyID, ModelID: route.Model.ID, StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error()})
		if more {
			return false
		}
		s.failChat(w, "gateway", keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	defer resp.Body.Close()
	s.noteQuota(route, resp.StatusCode, resp.Header)
	if resp.StatusCode >= 400 {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if more {
			return false
		}
		writeOpenAIError(w, resp.StatusCode, upstreamErrorMessage(payload), "server_error", "upstream_error")
		return true
	}
	s.noteAccount(route)
	stampDecision(w, r, route, 0, 0)
	if stream && strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "event-stream") {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		var err error
		if format == "anthropic" {
			err = wire.RelayAnthropic(w, resp.Body, route.Model.ID)
		} else {
			err = wire.RelayResponses(w, resp.Body)
		}
		if err != nil {
			_ = s.addRouteLog(r, store.LogInput{Source: "gateway", RouterKeyID: keyID, ModelID: route.Model.ID, StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error()})
		} else {
			_ = s.addRouteLog(r, store.LogInput{Source: "gateway", RouterKeyID: keyID, ModelID: route.Model.ID, StatusCode: http.StatusOK, LatencyMS: int(time.Since(started).Milliseconds())})
		}
		return true
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		if more {
			return false
		}
		s.failChat(w, "gateway", keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	prompt, completion := openai.UsageFromCompletion(payload)
	stampDecision(w, r, route, prompt, completion)
	_ = s.addRouteLog(r, store.LogInput{Source: "gateway", RouterKeyID: keyID, ModelID: route.Model.ID, StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()), PromptTokens: prompt, CompletionTokens: completion})
	s.rememberCache(r, askedModel(r, route), chatBody, payload, resp.StatusCode, false)
	s.writeTranslated(w, format, route.Model.ID, payload, stream)
	return true
}

func (s *Server) passAnthropic(w http.ResponseWriter, r *http.Request, keyID string, raw []byte, route store.Route, stream, more bool, started time.Time) bool {
	upstream, err := rewriteAnthropicModel(raw, route.Model.UpstreamID)
	if err != nil {
		if more {
			return false
		}
		s.failChat(w, "gateway", keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return true
	}
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("anthropic-version", "2023-06-01")
	if catalog.UsesSessionCookie(route.Model.ProviderSlug) {
		openai.ApplyCredential(header, route.APIKey, true)
	} else {
		header.Set("x-api-key", route.APIKey)
		header.Set("Authorization", "Bearer "+route.APIKey)
	}
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, adapt.AnthropicURL(route.BaseURL), upstream, header)
	if err != nil {
		return !more
	}
	defer resp.Body.Close()
	s.noteQuota(route, resp.StatusCode, resp.Header)
	if resp.StatusCode >= 400 {
		if more {
			return false
		}
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(payload)
		return true
	}
	s.noteAccount(route)
	if stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, resp.Body)
		return true
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return !more
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
	return true
}

func (s *Server) bufferTranslated(w http.ResponseWriter, r *http.Request, keyID, format string, chatBody []byte, route store.Route, stream, more bool, started time.Time) bool {
	quiet := *r
	quiet.Body = io.NopCloser(bytes.NewReader(forceStream(chatBody, false)))
	rec := newCapture()
	switch route.Protocol {
	case catalog.ProtocolAnthropic, catalog.ProtocolGemini:
		if !s.proxyNativeChat(rec, &quiet, "gateway", keyID, route, forceStream(chatBody, false), started, more) && more {
			return false
		}
	case catalog.ProtocolOllama, catalog.ProtocolCohere, catalog.ProtocolSearch, catalog.ProtocolEmbedding:
		if !s.proxySpecial(rec, &quiet, "gateway", keyID, route, forceStream(chatBody, false), started, more) && more {
			return false
		}
	default:
		return false
	}
	if rec.Code >= 400 {
		if more {
			return false
		}
		for key, values := range rec.Header() {
			w.Header()[key] = values
		}
		w.WriteHeader(rec.Code)
		_, _ = w.Write(rec.buf.Bytes())
		return true
	}
	s.writeTranslated(w, format, route.Model.ID, rec.buf.Bytes(), stream)
	return true
}

func (s *Server) writeTranslated(w http.ResponseWriter, format, model string, completion []byte, stream bool) {
	if format == "responses" {
		text := openai.ResponsesText(completion)
		if text == "" {
			var parsed struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
			}
			_ = json.Unmarshal(completion, &parsed)
			if len(parsed.Choices) > 0 {
				text = parsed.Choices[0].Message.Content
			}
		}
		if stream {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_ = wire.RelayResponses(w, strings.NewReader("data: "+string(mustChunk(text))+"\n\ndata: [DONE]\n\n"))
			return
		}
		raw, err := wire.OpenAIToResponse(model, text, 0, 0)
		if err != nil {
			writeOpenAIError(w, http.StatusBadGateway, err.Error(), "server_error", "internal_error")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)
		return
	}
	if stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_ = wire.RelayAnthropic(w, strings.NewReader("data: "+string(mustChunk(assistantText(completion)))+"\n\ndata: [DONE]\n\n"), model)
		return
	}
	raw, err := wire.OpenAIToAnthropic(model, completion)
	if err != nil {
		writeOpenAIError(w, http.StatusBadGateway, err.Error(), "server_error", "internal_error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func assistantText(completion []byte) string {
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	_ = json.Unmarshal(completion, &parsed)
	if len(parsed.Choices) == 0 {
		return ""
	}
	return parsed.Choices[0].Message.Content
}

func mustChunk(text string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"content": text}}},
	})
	return raw
}

func forceStream(body []byte, stream bool) []byte {
	var parsed map[string]any
	if json.Unmarshal(body, &parsed) != nil {
		return body
	}
	parsed["stream"] = stream
	out, err := json.Marshal(parsed)
	if err != nil {
		return body
	}
	return out
}

type capture struct {
	header http.Header
	buf    bytes.Buffer
	Code   int
}

func newCapture() *capture {
	return &capture{header: http.Header{}, Code: http.StatusOK}
}

func (c *capture) Header() http.Header { return c.header }
func (c *capture) Write(p []byte) (int, error) {
	if c.Code == 0 {
		c.Code = http.StatusOK
	}
	return c.buf.Write(p)
}
func (c *capture) WriteHeader(status int) { c.Code = status }

func rewriteAnthropicModel(raw []byte, model string) ([]byte, error) {
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	parsed["model"] = model
	return json.Marshal(parsed)
}

func askedModel(r *http.Request, route store.Route) string {
	if decision, ok := decisionFrom(r.Context()); ok && decision.Asked != "" {
		return decision.Asked
	}
	return route.Model.ID
}
