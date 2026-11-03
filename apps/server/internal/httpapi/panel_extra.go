package httpapi

import (
	"net/http"
	"runtime"
	"strconv"

	"airoute/server/desktoppref"
	"airoute/server/internal/store"
)

func (s *Server) activityItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid activity id")
		return
	}
	item, err := s.Store.GetLog(id)
	if err == store.ErrNotFound {
		writeAPIError(w, http.StatusNotFound, "request not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) clearActivity(w http.ResponseWriter, _ *http.Request) {
	if err := s.Store.ClearLogs(); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) usage(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.Usage()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var requests, errors, prompt, completion int
	var cost float64
	for _, row := range rows {
		requests += row.Requests
		errors += row.Errors
		prompt += row.PromptTokens
		completion += row.CompletionTokens
		cost += row.CostUSD
	}
	daysN, _ := strconv.Atoi(r.URL.Query().Get("days"))
	days, err := s.Store.UsageDays(daysN)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rows": rows,
		"days": days,
		"totals": map[string]any{
			"requests": requests, "errors": errors,
			"promptTokens": prompt, "completionTokens": completion, "costUsd": cost,
		},
	})
}

func (s *Server) settings(w http.ResponseWriter, _ *http.Request) {
	count, err := s.Store.CountLogs()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	features, err := s.Store.Features()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	oidc, err := s.Store.OIDCPublic()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataDir":     s.DataDir,
		"address":     s.Addr,
		"logCount":    count,
		"features":    features,
		"oidc":        oidc,
		"redirectUrl": "http://" + s.Addr + "/api/oidc/callback",
	})
}

func (s *Server) getDesktop(w http.ResponseWriter, _ *http.Request) {
	pref := desktoppref.Load(s.DataDir)
	writeJSON(w, http.StatusOK, map[string]any{
		"os":               runtime.GOOS,
		"startWithWindows": pref.StartWithWindows,
	})
}

func (s *Server) saveDesktop(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StartWithWindows bool `json:"startWithWindows"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := desktoppref.Save(s.DataDir, desktoppref.Pref{StartWithWindows: body.StartWithWindows}); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listFallbacks(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListFallbacks()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"fallbacks": items})
}

func (s *Server) saveFallback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string   `json:"name"`
		Models   []string `json:"models"`
		Strategy string   `json:"strategy"`
		Weights  []int    `json:"weights"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.SaveFallbackPlan(body.Name, body.Models, body.Strategy, body.Weights)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteFallback(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteFallback(r.PathValue("id")); err == store.ErrNotFound {
		writeAPIError(w, http.StatusNotFound, "fallback not found")
		return
	} else if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
