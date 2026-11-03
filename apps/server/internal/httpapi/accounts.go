package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/store"
)

func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	items, err := s.Store.ListAccounts(slug)
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": items})
}

func (s *Server) createAccount(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if _, ok := catalog.BySlug(slug); !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	var body accountBody
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.CreateAccount(slug, body.input())
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, store.ErrNotFound) {
			status = http.StatusNotFound
		}
		writeAPIError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) updateAccount(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var body accountBody
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.UpdateAccount(slug, r.PathValue("id"), body.input())
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "account not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	err := s.Store.DeleteAccount(r.PathValue("slug"), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "account not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type accountBody struct {
	Name     *string `json:"name"`
	APIKey   *string `json:"apiKey"`
	Priority *int    `json:"priority"`
	Enabled  *bool   `json:"enabled"`
}

func (b accountBody) input() store.AccountInput {
	return store.AccountInput{Name: b.Name, APIKey: b.APIKey, Priority: b.Priority, Enabled: b.Enabled}
}

func (s *Server) expandRoutes(routes []store.Route) ([]store.Route, error) {
	out := make([]store.Route, 0, len(routes))
	for _, route := range routes {
		parts, err := s.Store.ExpandAccounts(route)
		if err != nil {
			return nil, err
		}
		out = append(out, parts...)
	}
	return out, nil
}

func (s *Server) noteAccount(route store.Route) {
	if route.AccountID == "" {
		return
	}
	_ = s.Store.TouchAccount(route.AccountID)
}

func (s *Server) tryChatRoutes(w http.ResponseWriter, r *http.Request, source, keyID string, routes []store.Route, body []byte, started time.Time) {
	multiModel := false
	firstID := routes[0].Model.ID
	for _, route := range routes[1:] {
		if route.Model.ID != firstID {
			multiModel = true
			break
		}
	}
	var lastMessage string
	for i, route := range routes {
		last := i == len(routes)-1
		route.APIKey = providerCredential(route.Model.ProviderSlug, route.APIKey)
		if !routeReady(route) {
			lastMessage = routeBlockedMessage(route.Model.ID, route)
			if last {
				s.failChat(w, source, keyID, route.Model.ID, http.StatusNotFound, "invalid_request_error", "model_not_found", lastMessage, started)
				return
			}
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusNotFound, ErrorMessage: accountNote(route, lastMessage),
			})
			continue
		}
		if multiModel && (route.Protocol != catalog.ProtocolOpenAIChat || (route.Model.Kind != "" && route.Model.Kind != catalog.KindChat)) {
			lastMessage = route.Model.ID + " cannot be used in a fallback. Fallback steps are OpenAI-compatible chat models."
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadRequest, ErrorMessage: lastMessage,
			})
			continue
		}
		var done bool
		switch route.Protocol {
		case catalog.ProtocolAnthropic, catalog.ProtocolGemini:
			done = s.proxyNativeChat(w, r, source, keyID, route, body, started, !last)
		case catalog.ProtocolOllama, catalog.ProtocolCohere, catalog.ProtocolSearch, catalog.ProtocolEmbedding:
			done = s.proxySpecial(w, r, source, keyID, route, body, started, !last)
		case catalog.ProtocolOpenAIChat:
			if route.Model.Kind != "" && route.Model.Kind != catalog.KindChat {
				s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", kindEndpointMessage(route.Model.Kind), started)
				return
			}
			done = s.finishOpenAI(w, r, source, keyID, route, body, started, !last)
		default:
			if route.Model.Kind == catalog.KindDecision || route.Protocol == catalog.ProtocolSystemOne {
				s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", kindEndpointMessage(catalog.KindDecision), started)
				return
			}
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "unsupported_protocol", "This provider protocol is not supported yet.", started)
			return
		}
		if done {
			return
		}
		if route.AccountName != "" {
			lastMessage = route.AccountName + " failed. The next account was tried."
		} else {
			lastMessage = "The provider returned an error. The next model in the fallback was tried."
		}
	}
	if lastMessage == "" {
		lastMessage = "Every account for this model failed."
	}
	if source == "playground" {
		writeAPIError(w, http.StatusBadGateway, lastMessage)
		return
	}
	writeOpenAIError(w, http.StatusBadGateway, lastMessage, "server_error", "upstream_error")
}

func accountNote(route store.Route, message string) string {
	if route.AccountName == "" {
		return message
	}
	return strings.TrimSpace(message + " (" + route.AccountName + ")")
}
