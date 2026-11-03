package admin

import (
	"database/sql"
	"net/http"
	"strings"

	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/notify"
)

func (s *Store) SpendSummary() []any {
	rows := s.Logs("", "", 1000)
	by := map[string]float64{}
	for _, rec := range rows {
		model := asString(rec["model"])
		if model == "" {
			model = "unknown"
		}
		cost := asMap(rec["cost"])
		by[model] += asFloat(cost["usd"])
	}
	var items []any
	for model, usd := range by {
		items = append(items, map[string]any{"model": model, "usd": usd})
	}
	if items == nil {
		items = []any{}
	}
	return items
}

func (s *Store) SpendLedger() []any {
	rows := s.Logs("", "", 200)
	var items []any
	for _, rec := range rows {
		items = append(items, map[string]any{
			"id": rec["id"], "model": rec["model"], "provider": rec["provider"],
			"at": rec["started_at"], "usd": asMap(rec["cost"])["usd"], "status": rec["status_code"],
		})
	}
	if items == nil {
		items = []any{}
	}
	return items
}

func (s *Store) CacheEntries(limit int) []any {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(`SELECT key, model, exact, hits, created_at FROM cache_entries ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return []any{}
	}
	defer rows.Close()
	var items []any
	for rows.Next() {
		var key, model, created string
		var exact, hits int
		if rows.Scan(&key, &model, &exact, &hits, &created) != nil {
			continue
		}
		items = append(items, map[string]any{"key": key, "model": model, "exact": exact == 1, "hits": hits, "created_at": created})
	}
	if items == nil {
		items = []any{}
	}
	return items
}

func (a *API) testChannel(w http.ResponseWriter, name string) {
	res, err := a.Store.Get("alerts/channels", name)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "No channel with that name.")
		return
	}
	url := asString(res.Private["url"])
	if url == "" {
		url = asString(res.Spec["url"])
	}
	if err := gateway.SafeHTTPURL(url); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_url", err.Error())
		return
	}
	secret := asString(res.Private["signing_secret"])
	err = notify.Post(nil, notify.Channel{Name: name, URL: url, Secret: secret}, notify.Message{Title: "WowRouter test", Body: "Channel test"})
	if err != nil {
		writeErr(w, http.StatusBadGateway, "delivery_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) mitmStatus(w http.ResponseWriter, _ *http.Request) {
	var pem []byte
	if a.Proxy != nil {
		pem, _ = a.Proxy.CA()
	}
	running := a.Proxy != nil && a.Proxy.Running()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": running, "decrypt": running, "install_ca": false,
		"ca_pem": string(pem),
		"note":   "The proxy listens only on loopback and does not install its CA. Trust the certificate yourself before pointing a client at it.",
	})
}

func (a *API) mitmStart(w http.ResponseWriter, r *http.Request) {
	var raw map[string]any
	if err := readBody(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if a.Proxy == nil {
		writeErr(w, http.StatusInternalServerError, "internal", "proxy is not configured")
		return
	}
	if raw["enabled"] != true {
		a.Proxy.Stop()
		a.mitmStatus(w, r)
		return
	}
	addr := asString(raw["addr"])
	if addr == "" {
		addr = "127.0.0.1:8790"
	}
	if !strings.HasPrefix(addr, "127.0.0.1:") && !strings.HasPrefix(addr, "localhost:") && !strings.HasPrefix(addr, "[::1]:") {
		writeErr(w, http.StatusBadRequest, "invalid_body", "The proxy only listens on a loopback address.")
		return
	}
	if err := a.Proxy.Start(addr); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	a.Store.AddAudit(map[string]any{"action": "update", "resource": "runtime/mitm", "detail": "enabled"})
	a.mitmStatus(w, r)
}

// keep sql import used when cache query returns ErrNoRows in other files
var _ = sql.ErrNoRows
