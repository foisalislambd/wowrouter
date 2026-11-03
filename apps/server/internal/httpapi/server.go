package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/provider/openai"
	"airoute/server/internal/sse"
	"airoute/server/internal/store"
)

type Server struct {
	Store   *Store
	OpenAI  *openai.Client
	WebDir  string
	Addr    string
	DataDir string
	Stop    func()
}

// Store is the persistence surface the HTTP layer needs.
type Store = store.Store

func New(db *store.Store, webDir, addr, dataDir string) *Server {
	return &Server{
		Store:   db,
		OpenAI:  openai.NewClient(),
		WebDir:  webDir,
		Addr:    addr,
		DataDir: dataDir,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("POST /api/shutdown", s.shutdown)
	mux.HandleFunc("GET /api/overview", s.overview)
	mux.HandleFunc("GET /api/providers", s.listProviders)
	mux.HandleFunc("GET /api/providers/{slug}", s.getProvider)
	mux.HandleFunc("PUT /api/providers/{slug}", s.updateProvider)
	mux.HandleFunc("GET /api/providers/{slug}/accounts", s.listAccounts)
	mux.HandleFunc("POST /api/providers/{slug}/accounts", s.createAccount)
	mux.HandleFunc("PUT /api/providers/{slug}/accounts/{id}", s.updateAccount)
	mux.HandleFunc("DELETE /api/providers/{slug}/accounts/{id}", s.deleteAccount)
	mux.HandleFunc("POST /api/providers/{slug}/test", s.testProvider)
	mux.HandleFunc("POST /api/providers/{slug}/models/load", s.loadProviderModels)
	mux.HandleFunc("GET /api/providers/{slug}/models", s.listModels)
	mux.HandleFunc("PUT /api/providers/{slug}/models/{model...}", s.setModelActive)
	mux.HandleFunc("GET /api/keys", s.listKeys)
	mux.HandleFunc("POST /api/keys", s.createKey)
	mux.HandleFunc("DELETE /api/keys/{id}", s.deleteKey)
	mux.HandleFunc("GET /api/models", s.listActiveModels)
	mux.HandleFunc("GET /api/activity", s.activity)
	mux.HandleFunc("GET /api/activity/{id}", s.activityItem)
	mux.HandleFunc("DELETE /api/activity", s.clearActivity)
	mux.HandleFunc("GET /api/usage", s.usage)
	mux.HandleFunc("GET /api/settings", s.settings)
	mux.HandleFunc("GET /api/desktop", s.getDesktop)
	mux.HandleFunc("PUT /api/desktop", s.saveDesktop)
	mux.HandleFunc("GET /api/fallbacks", s.listFallbacks)
	mux.HandleFunc("POST /api/fallbacks", s.saveFallback)
	mux.HandleFunc("DELETE /api/fallbacks/{id}", s.deleteFallback)
	mux.HandleFunc("POST /api/playground/chat", s.playground)
	mux.HandleFunc("POST /api/playground/media", s.playgroundMedia)
	mux.HandleFunc("POST /api/playground/decision", s.playgroundDecision)
	mux.HandleFunc("GET /v1/models", s.gatewayModels)
	mux.HandleFunc("POST /v1/chat/completions", s.gatewayChat)
	mux.HandleFunc("POST /v1/systemone", s.gatewayDecision)
	mux.HandleFunc("POST /v1/images/generations", s.gatewayImages)
	mux.HandleFunc("POST /v1/videos/generations", s.gatewayVideos)
	mux.HandleFunc("/", s.spa)
	return mux
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "wowrouter"})
}

func (s *Server) shutdown(w http.ResponseWriter, _ *http.Request) {
	if s.Stop == nil {
		writeAPIError(w, http.StatusInternalServerError, "shutdown is not available")
		return
	}
	w.WriteHeader(http.StatusNoContent)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	go s.Stop()
}

func (s *Server) overview(w http.ResponseWriter, _ *http.Request) {
	providers, active, keys, err := s.Store.Overview()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"providers":    providers,
		"activeModels": active,
		"routerKeys":   keys,
		"endpoint":     "http://" + s.Addr + "/v1",
		"dataDir":      "",
	})
}

func (s *Server) listProviders(w http.ResponseWriter, r *http.Request) {
	limit := 24
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	page, err := s.Store.ListProvidersPage(r.URL.Query().Get("q"), r.URL.Query().Get("category"), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"providers":  page.Providers,
		"categories": page.Categories,
		"total":      page.Total,
		"limit":      page.Limit,
		"offset":     page.Offset,
	})
}

func (s *Server) getProvider(w http.ResponseWriter, r *http.Request) {
	item, err := s.Store.GetProvider(r.PathValue("slug"))
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) updateProvider(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if _, ok := catalog.BySlug(slug); !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	var body struct {
		APIKey          *string `json:"apiKey"`
		BaseURL         *string `json:"baseUrl"`
		Enabled         *bool   `json:"enabled"`
		AccountStrategy *string `json:"accountStrategy"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.BaseURL != nil {
		if err := validateBaseURL(*body.BaseURL); err != nil {
			writeAPIError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	item, err := s.Store.UpdateProvider(slug, store.ProviderUpdate{
		APIKey:          body.APIKey,
		BaseURL:         body.BaseURL,
		Enabled:         body.Enabled,
		AccountStrategy: body.AccountStrategy,
	})
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) testProvider(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var body struct {
		APIKey    *string `json:"apiKey"`
		BaseURL   *string `json:"baseUrl"`
		AccountID *string `json:"accountId"`
	}
	if err := readJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	baseURL, apiKey, protocol, _, err := s.Store.ProviderSecret(slug)
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body.BaseURL != nil && strings.TrimSpace(*body.BaseURL) != "" {
		if err := validateBaseURL(*body.BaseURL); err != nil {
			writeAPIError(w, http.StatusBadRequest, err.Error())
			return
		}
		baseURL = strings.TrimRight(strings.TrimSpace(*body.BaseURL), "/")
	}
	if body.AccountID != nil && strings.TrimSpace(*body.AccountID) != "" && (body.APIKey == nil || strings.TrimSpace(*body.APIKey) == "") {
		apiKey, err = s.Store.AccountSecret(slug, strings.TrimSpace(*body.AccountID))
		if errors.Is(err, store.ErrNotFound) {
			writeAPIError(w, http.StatusNotFound, "account not found")
			return
		}
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if body.APIKey != nil && strings.TrimSpace(*body.APIKey) != "" {
		apiKey = strings.TrimSpace(*body.APIKey)
	}
	apiKey = providerCredential(slug, apiKey)
	def, known := catalog.BySlug(slug)
	if apiKey == "" && (!known || !def.KeyOptional) {
		writeAPIError(w, http.StatusBadRequest, credentialMissingMessage(slug))
		return
	}
	if protocol != catalog.ProtocolOpenAIChat {
		writeAPIError(w, http.StatusBadRequest, "this provider protocol is not supported yet")
		return
	}
	count, err := s.OpenAI.Ping(r.Context(), baseURL, apiKey, catalog.UsesSessionCookie(slug))
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "upstreamModels": count})
}

func (s *Server) listActiveModels(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListActiveModels()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if chains, err := s.Store.ListFallbacks(); err == nil {
		for _, chain := range chains {
			if len(chain.Models) < 2 {
				continue
			}
			items = append(items, store.Model{
				ID:           chain.ModelID,
				ProviderSlug: "fallback",
				UpstreamID:   chain.ID,
				DisplayName:  chain.Name,
				Description:  strings.Join(chain.Models, " → "),
				Kind:         catalog.KindChat,
				Inputs:       "text",
				Outputs:      "text",
				Active:       true,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": items})
}

func (s *Server) listModels(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	page, err := s.Store.ListModelsPage(r.PathValue("slug"), r.URL.Query().Get("q"), limit, offset)
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"models": page.Models,
		"total":  page.Total,
		"limit":  page.Limit,
		"offset": page.Offset,
	})
}

func (s *Server) setModelActive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Active bool `json:"active"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.SetModelActive(r.PathValue("slug"), r.PathValue("model"), body.Active)
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "model not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) listKeys(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListRouterKeys()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": items})
}

func (s *Server) createKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	created, err := s.Store.CreateRouterKey(body.Name)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) deleteKey(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteRouterKey(r.PathValue("id")); errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "key not found")
		return
	} else if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) activity(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListLogs(50)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"activity": items})
}

func (s *Server) gatewayModels(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	items, err := s.Store.ListActiveModels()
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	data := make([]map[string]any, 0, len(items))
	for _, item := range items {
		data = append(data, map[string]any{
			"id":       item.ID,
			"object":   "model",
			"created":  0,
			"owned_by": item.ProviderSlug,
		})
	}
	if chains, err := s.Store.ListFallbacks(); err == nil {
		for _, chain := range chains {
			data = append(data, map[string]any{
				"id":       chain.ModelID,
				"object":   "model",
				"created":  0,
				"owned_by": "fallback",
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data})
}

func (s *Server) gatewayChat(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	s.proxyChat(w, r, "gateway", keyID)
}

func (s *Server) playground(w http.ResponseWriter, r *http.Request) {
	s.proxyChat(w, r, "playground", "")
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (string, bool) {
	token := bearerToken(r)
	if token == "" {
		writeOpenAIError(w, http.StatusUnauthorized, "Missing API key. Create one in the WowRouter panel and send it as a Bearer token.", "authentication_error", "invalid_api_key")
		return "", false
	}
	id, err := s.Store.AuthenticateRouterKey(token)
	if errors.Is(err, store.ErrNotFound) {
		writeOpenAIError(w, http.StatusUnauthorized, "Incorrect API key.", "authentication_error", "invalid_api_key")
		return "", false
	}
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return "", false
	}
	return id, true
}

func (s *Server) proxyChat(w http.ResponseWriter, r *http.Request, source, keyID string) {
	started := time.Now()
	body, err := readBody(r, 20<<20)
	if err != nil {
		s.failChat(w, source, keyID, "", http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return
	}
	var meta struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &meta); err != nil || strings.TrimSpace(meta.Model) == "" {
		s.failChat(w, source, keyID, meta.Model, http.StatusBadRequest, "invalid_request_error", "model_required", "The model field is required.", started)
		return
	}

	routes, err := s.Store.ResolveChain(meta.Model)
	if errors.Is(err, store.ErrNotFound) {
		message := "The model `" + meta.Model + "` does not exist."
		s.failChat(w, source, keyID, meta.Model, http.StatusNotFound, "invalid_request_error", "model_not_found", message, started)
		return
	}
	if errors.Is(err, store.ErrFallbackEmpty) {
		s.failChat(w, source, keyID, meta.Model, http.StatusBadRequest, "invalid_request_error", "model_not_found", err.Error(), started)
		return
	}
	if err != nil {
		s.failChat(w, source, keyID, meta.Model, http.StatusInternalServerError, "server_error", "internal_error", err.Error(), started)
		return
	}
	routes, err = s.expandRoutes(routes)
	if err != nil {
		s.failChat(w, source, keyID, meta.Model, http.StatusInternalServerError, "server_error", "internal_error", err.Error(), started)
		return
	}
	if len(routes) > 1 {
		s.tryChatRoutes(w, r, source, keyID, routes, body, started)
		return
	}
	route := routes[0]
	route.APIKey = providerCredential(route.Model.ProviderSlug, route.APIKey)
	if !routeReady(route) {
		message := routeBlockedMessage(meta.Model, route)
		s.failChat(w, source, keyID, route.Model.ID, http.StatusNotFound, "invalid_request_error", "model_not_found", message, started)
		return
	}
	switch route.Protocol {
	case catalog.ProtocolAnthropic, catalog.ProtocolGemini:
		s.proxyNativeChat(w, r, source, keyID, route, body, started, false)
		return
	case catalog.ProtocolOllama, catalog.ProtocolCohere, catalog.ProtocolSearch, catalog.ProtocolEmbedding:
		s.proxySpecial(w, r, source, keyID, route, body, started, false)
		return
	case catalog.ProtocolOpenAIChat:
		if route.Model.Kind != "" && route.Model.Kind != catalog.KindChat {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", kindEndpointMessage(route.Model.Kind), started)
			return
		}
	default:
		if route.Model.Kind == catalog.KindDecision || route.Protocol == catalog.ProtocolSystemOne {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", kindEndpointMessage(catalog.KindDecision), started)
			return
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "unsupported_protocol", "This provider protocol is not supported yet.", started)
		return
	}

	s.finishOpenAI(w, r, source, keyID, route, body, started, false)
}

func (s *Server) finishOpenAI(w http.ResponseWriter, r *http.Request, source, keyID string, route store.Route, body []byte, started time.Time, retry bool) bool {
	upstreamBody, stream, err := openai.RewriteChatModel(body, route.Model.UpstreamID)
	if err != nil {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return true
	}

	path := "/chat/completions"
	responsesAPI := false
	if route.Model.ProviderSlug == "opencode" && openai.OpencodeFree(route.Model.UpstreamID) {
		upstreamBody, path, err = openai.PrepareOpencode(upstreamBody, route.Model.UpstreamID)
		if err != nil {
			if retry {
				_ = s.Store.AddLog(store.LogInput{
					Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
					StatusCode: http.StatusBadRequest, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(),
				})
				return false
			}
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
			return true
		}
		responsesAPI = path == "/responses"
		stream = true
	}

	endpoint := strings.TrimRight(route.BaseURL, "/") + path
	header := http.Header{}
	if route.Model.ProviderSlug == "opencode" && openai.OpencodeFree(route.Model.UpstreamID) {
		for key, value := range openai.OpencodeHeaders(route.APIKey) {
			header.Set(key, value)
		}
	} else {
		endpoint = strings.TrimRight(route.BaseURL, "/") + "/chat/completions"
		openai.ApplyCredential(header, route.APIKey, catalog.UsesSessionCookie(route.Model.ProviderSlug))
		header.Set("Content-Type", "application/json")
		header.Set("Accept", "application/json, text/event-stream")
	}
	request := providerRequest(http.MethodPost, endpoint, header, upstreamBody)
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, endpoint, upstreamBody, header)
	if err != nil {
		_ = s.Store.AddLog(store.LogInput{
			Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
			StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
		})
		if retry {
			return false
		}
		if source == "playground" {
			writePlaygroundFailure(w, http.StatusBadGateway, err.Error(), request)
			return true
		}
		writeOpenAIError(w, http.StatusBadGateway, err.Error(), "server_error", "upstream_error")
		return true
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && retry {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		message := upstreamErrorMessage(payload)
		_ = s.Store.AddLog(store.LogInput{
			Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
			StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: message, Request: string(request),
		})
		return false
	}

	if responsesAPI && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		payload, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
		if err != nil {
			if retry {
				_ = s.Store.AddLog(store.LogInput{
					Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
					StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
				})
				return false
			}
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
			return true
		}
		text := openai.ResponsesText(payload)
		s.noteAccount(route)
		_ = s.Store.AddLog(store.LogInput{
			Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
			StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()), Request: string(request),
		})
		if stream || source == "playground" {
			writeChatChunk(w, route.Model.ID, text, request)
			return true
		}
		writeJSON(w, http.StatusOK, openAICompletion(route.Model.ID, text, 0, 0))
		return true
	}

	if stream && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		format := streamFormat(route.Protocol)
		writeStreamHeaders(w, resp)
		if source == "playground" {
			writeRequestEvent(w, request)
		}
		_ = sse.Relay(w, resp.Body, format)
		prompt, completion := 0, 0
		message := ""
		if format != nil {
			prompt, completion = format.Usage()
			message = format.Err()
		}
		s.noteAccount(route)
		_ = s.Store.AddLog(store.LogInput{
			Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
			StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()),
			PromptTokens: prompt, CompletionTokens: completion, ErrorMessage: message, Request: string(request),
		})
		return true
	}

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		if retry {
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
			})
			return false
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	prompt, completion := openai.UsageFromCompletion(payload)
	message := ""
	if resp.StatusCode >= 400 {
		message = upstreamErrorMessage(payload)
	}
	if resp.StatusCode < 400 {
		s.noteAccount(route)
	}
	_ = s.Store.AddLog(store.LogInput{
		Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
		StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()),
		PromptTokens: prompt, CompletionTokens: completion, ErrorMessage: message, Request: string(request),
	})
	if source == "playground" && resp.StatusCode >= 400 {
		writePlaygroundFailure(w, resp.StatusCode, message, request)
		return true
	}
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(payload)
	return true
}

func (s *Server) failChat(w http.ResponseWriter, source, keyID, modelID string, status int, typ, code, message string, started time.Time) {
	_ = s.Store.AddLog(store.LogInput{
		Source: source, RouterKeyID: keyID, ModelID: modelID,
		StatusCode: status, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: message,
	})
	if source == "playground" {
		writeAPIError(w, status, message)
		return
	}
	writeOpenAIError(w, status, message, typ, code)
}

func (s *Server) spa(w http.ResponseWriter, r *http.Request) {
	if s.WebDir == "" {
		writeAPIError(w, http.StatusNotFound, "panel build not found; run npm run dev:panel or npm run build:panel")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	rel := strings.TrimPrefix(filepath.Clean("/"+r.URL.Path), string(filepath.Separator))
	if rel == "." || rel == "" {
		rel = "index.html"
	}
	file := filepath.Join(s.WebDir, rel)
	root, err := filepath.Abs(s.WebDir)
	if err != nil {
		http.Error(w, "panel unavailable", http.StatusInternalServerError)
		return
	}
	abs, err := filepath.Abs(file)
	if err != nil || (abs != root && !strings.HasPrefix(abs, root+string(os.PathSeparator))) {
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(abs); err == nil && !info.IsDir() {
		http.ServeFile(w, r, abs)
		return
	}
	http.ServeFile(w, r, filepath.Join(root, "index.html"))
}

func streamFormat(protocol string) sse.Format {
	switch protocol {
	case catalog.ProtocolOpenAIChat:
		return &sse.OpenAIChat{}
	default:
		return nil
	}
}

func writeStreamHeaders(w http.ResponseWriter, resp *http.Response) {
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/event-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(resp.StatusCode)
}

func upstreamErrorMessage(payload []byte) string {
	var parsed struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &parsed); err == nil && parsed.Error.Message != "" {
		return parsed.Error.Message
	}
	text := strings.TrimSpace(string(payload))
	if len(text) > 240 {
		text = text[:240]
	}
	return text
}

func providerCredential(slug, apiKey string) string {
	if apiKey != "" {
		return apiKey
	}
	provider, ok := catalog.BySlug(slug)
	if ok {
		return provider.AnonymousKey
	}
	return ""
}

func routeReady(route store.Route) bool {
	if !route.Model.Active || !route.ProviderOn {
		return false
	}
	return route.APIKey != "" || keyOptional(route)
}

func keyOptional(route store.Route) bool {
	provider, ok := catalog.BySlug(route.Model.ProviderSlug)
	return ok && provider.KeyOptional
}

func routeBlockedMessage(requested string, route store.Route) string {
	if !route.Model.Active {
		return "The model `" + requested + "` is not active. Turn it on from the provider page."
	}
	if route.APIKey == "" && !keyOptional(route) {
		return "Save an API key for " + route.Model.ProviderSlug + " before calling this model."
	}
	return route.Model.ProviderSlug + " is disabled. Enable the provider before calling this model."
}

func validateBaseURL(raw string) error {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	switch trimmed {
	case "auggie://cli/stdio", "devin://acp/stdio", "zcode://app-server/stdio", "codex-app-server://cli/websocket":
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || parsed.Scheme == "" || parsed.Hostname() == "" {
		return errors.New("base URL must be an absolute URL")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	host := parsed.Hostname()
	if parsed.Scheme == "http" && (host == "127.0.0.1" || host == "localhost") {
		return nil
	}
	return errors.New("base URL must use https, or http on localhost")
}
