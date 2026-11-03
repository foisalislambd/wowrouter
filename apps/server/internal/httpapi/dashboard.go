package httpapi

import (
	"errors"
	"net/http"

	"airoute/server/internal/store"
)

func (s *Server) dashboard(w http.ResponseWriter, _ *http.Request) {
	providers, active, keys, err := s.Store.Overview()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	enabled, err := s.Store.EnabledProviderCount()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	today, err := s.Store.Today()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	days, err := s.Store.UsageDays(7)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := s.Store.Usage()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(rows) > 5 {
		rows = rows[:5]
	}
	health, err := s.Store.ProviderStats()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(health) > 6 {
		health = health[:6]
	}
	locked, _ := s.Store.PanelLocked()
	writeJSON(w, http.StatusOK, map[string]any{
		"providers": providers, "enabledProviders": enabled, "activeModels": active, "routerKeys": keys,
		"endpoint":       "http://" + s.Addr + "/v1",
		"today":          today,
		"days":           days,
		"topModels":      rows,
		"providerHealth": health,
		"steps": []map[string]any{
			{"id": "provider", "label": "Save a provider key and turn the provider on", "href": "/providers?state=setup", "done": enabled > 0},
			{"id": "model", "label": "Turn on one chat model", "href": "/models", "done": active > 0},
			{"id": "key", "label": "Create a router key for your coding agent", "href": "/keys", "done": keys > 0},
			{"id": "client", "label": "Point a client at this endpoint", "href": "/clients", "done": false},
			{"id": "password", "label": "Panel password stays off until you opt in", "href": "/settings", "done": !locked},
		},
	})
}

func (s *Server) providerHealth(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if _, err := s.Store.GetProvider(slug); errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	} else if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	requests, errorsN, avg, err := s.Store.ProviderCallStats(slug)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"requests": requests, "errors": errorsN, "avgLatencyMs": avg,
	})
}
