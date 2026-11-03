package httpapi

import (
	"net/http"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/store"
)

func (s *Server) proxyFallback(w http.ResponseWriter, r *http.Request, source, keyID string, routes []store.Route, body []byte, started time.Time) {
	var lastMessage string
	for i, route := range routes {
		route.APIKey = providerCredential(route.Model.ProviderSlug, route.APIKey)
		last := i == len(routes)-1
		if !routeReady(route) {
			lastMessage = routeBlockedMessage(route.Model.ID, route)
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusNotFound, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: lastMessage,
			})
			continue
		}
		if strings.TrimSpace(route.BaseURL) == "" || route.Protocol != catalog.ProtocolOpenAIChat || (route.Model.Kind != "" && route.Model.Kind != catalog.KindChat) {
			lastMessage = route.Model.ID + " cannot be used in a fallback. Fallback steps are OpenAI-compatible chat models."
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadRequest, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: lastMessage,
			})
			continue
		}
		if s.finishOpenAI(w, r, source, keyID, route, body, started, !last) {
			return
		}
		lastMessage = "The provider returned an error. The next model in the fallback was tried."
	}
	if lastMessage == "" {
		lastMessage = "Every model in this fallback failed."
	}
	if source == "playground" {
		writeAPIError(w, http.StatusBadGateway, lastMessage)
		return
	}
	writeOpenAIError(w, http.StatusBadGateway, lastMessage, "server_error", "upstream_error")
}
