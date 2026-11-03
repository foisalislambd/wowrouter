package admin

// Modified by WowRouter.
// Derived from Antirion (https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, Apache-2.0.

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"wowrouter/server/internal/catalogdata"
	"wowrouter/server/internal/gateway"
)

func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/admin/v1")
	path = strings.Trim(path, "/")
	if !a.public(path) && !a.authorized(r) {
		writeErr(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
		return
	}
	a.route(w, r, path)
}

func (a *API) public(path string) bool {
	switch path {
	case "auth/login_options", "auth/session", "auth/logout", "auth/local/login", "health", "openapi.json":
		return true
	default:
		return false
	}
}

func (a *API) authorized(r *http.Request) bool {
	if c, err := r.Cookie("wowrouter_session"); err == nil && a.Store.SessionOK(c.Value) {
		return true
	}
	token := bearer(r)
	if a.Store.BootstrapMatches(token) || a.Store.SessionOK(token) {
		return true
	}
	return false
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func (a *API) route(w http.ResponseWriter, r *http.Request, path string) {
	switch {
	case path == "auth/login_options" && r.Method == http.MethodGet:
		a.loginOptions(w, r)
	case path == "auth/session" && r.Method == http.MethodPost:
		a.session(w, r)
	case path == "auth/local/login" && r.Method == http.MethodPost:
		a.localLogin(w, r)
	case path == "auth/password" && (r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodPost):
		a.passwordSettings(w, r)
	case path == "auth/logout" && r.Method == http.MethodPost:
		if c, err := r.Cookie("wowrouter_session"); err == nil {
			a.Store.DeleteSession(c.Value)
		}
		http.SetCookie(w, &http.Cookie{Name: "wowrouter_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
		w.WriteHeader(http.StatusNoContent)
	case path == "auth/me" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, me())
	case path == "auth/me/preferences":
		a.preferences(w, r)
	case path == "auth/me/mfa" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "recovery_codes_remaining": 0})
	case path == "auth/me/tokens" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "auth/me/push" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"public_key": "", "subscriptions": []any{}})
	case path == "auth/sessions" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "auth/scim/status" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false, "users": 0, "groups": 0, "last_request_at": nil, "last_error": nil})
	case path == "status" && r.Method == http.MethodGet:
		a.status(w)
	case path == "health" && r.Method == http.MethodGet:
		a.health(w)
	case path == "openapi.json" && r.Method == http.MethodGet:
		if len(a.OpenAPI) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"openapi": "3.1.0", "info": map[string]any{"title": "WowRouter Admin API", "version": a.Version}})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(a.OpenAPI)
	case path == "config" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, a.Store.ConfigDocument())
	case path == "config/generations" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "analytics/usage" && r.Method == http.MethodGet:
		a.usage(w, r)
	case path == "analytics/latency_histogram" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"bounds": []any{}, "counts": []any{}, "p50": 0, "p95": 0, "p99": 0})
	case path == "reports/availability" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{map[string]any{"availability": 1, "group": map[string]any{"gateway": "wowrouter"}}}, "next_cursor": nil})
	case path == "reports/provider_pressure" && r.Method == http.MethodGet:
		a.pressure(w, r)
	case path == "reports/guardrails/summary" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "reports/spend/summary" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": a.Store.SpendSummary(), "next_cursor": nil})
	case path == "reports/spend/ledger" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": a.Store.SpendLedger(), "next_cursor": nil})
	case path == "logs" && r.Method == http.MethodGet:
		a.logs(w, r)
	case strings.HasPrefix(path, "logs/") && r.Method == http.MethodGet && !strings.Contains(path, "views"):
		id := strings.TrimPrefix(path, "logs/")
		if rec, ok := a.Store.LogByID(id); ok {
			writeJSON(w, http.StatusOK, rec)
			return
		}
		writeErr(w, http.StatusNotFound, "not_found", "That request is not in the log.")
	case path == "logs/schema" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"fields": []any{}})
	case path == "logs/views" && r.Method == http.MethodGet:
		a.collection(w, r, "logs/views", "")
	case path == "audit" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": a.Store.ListAudit(100), "next_cursor": nil})
	case path == "provider-types" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": providerTypes(), "next_cursor": nil})
	case strings.HasPrefix(path, "providers/") && strings.HasSuffix(path, "/models") && r.Method == http.MethodGet:
		a.providerModels(w, r, strings.TrimSuffix(strings.TrimPrefix(path, "providers/"), "/models"))
	case path == "catalog" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"bundled": map[string]any{"version": "models.dev", "price_version": "models.dev", "entries": catalogdata.ModelCount()},
			"runtime": nil,
			"items":   []any{},
		})
	case path == "routing/tiers" && r.Method == http.MethodGet:
		a.tiers(w)
	case path == "runtime/providers" && r.Method == http.MethodGet:
		a.runtimeProviders(w)
	case path == "runtime/deployments" && r.Method == http.MethodGet:
		a.runtimeDeployments(w)
	case path == "runtime/plugins" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "runtime/nodes" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{a.node()}, "next_cursor": nil})
	case path == "runtime/guardrails" && r.Method == http.MethodGet:
		a.runtimeGuardrails(w)
	case path == "runtime/cache" && r.Method == http.MethodGet:
		entries, hits := a.Store.CacheStats()
		writeJSON(w, http.StatusOK, map[string]any{"backend": "sqlite", "healthy": true, "entries": entries, "bytes": nil, "hits": hits, "misses": 0, "semantic": []any{}})
	case path == "runtime/budgets" && r.Method == http.MethodGet:
		a.budgets(w)
	case path == "runtime/budgets/events" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "runtime/alerts/channels" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "runtime/alerts/webhooks" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "runtime/slos" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "runtime/mcp/sessions" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "runtime/audit/sinks" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "cluster" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"mode": "standalone", "nodes": []any{a.node()}, "jobs": []any{}, "totals": map[string]any{"in_flight": 0, "max_in_flight": 1024, "queue_depth": 0}})
	case path == "cluster/converged" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"converged": true})
	case path == "alerts" && r.Method == http.MethodGet:
		a.alerts(w, r)
	case strings.HasPrefix(path, "alerts/") && strings.Contains(path, ":"):
		a.alertAction(w, r, path)
	case strings.HasPrefix(path, "alerts/") && r.Method == http.MethodGet && !strings.Contains(path, "rules") && !strings.Contains(path, "channels"):
		id := strings.TrimPrefix(path, "alerts/")
		for _, alert := range a.Store.Alerts() {
			if asString(alert["id"]) == id {
				writeJSON(w, http.StatusOK, alert)
				return
			}
		}
		writeErr(w, http.StatusNotFound, "not_found", "No alert with that id.")
	case path == "anomalies" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "guardrails/events" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "budgets/overage_requests" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "next_cursor": nil})
	case path == "cache/entries" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": a.Store.CacheEntries(100), "next_cursor": nil})
	case path == "runtime/mitm" && r.Method == http.MethodGet:
		a.mitmStatus(w, r)
	case path == "runtime/mitm" && r.Method == http.MethodPost:
		a.mitmStart(w, r)
	case path == "pricing/deployments" && r.Method == http.MethodGet:
		a.prices(w)
	case path == "roles" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{map[string]any{"name": "gateway_admin", "description": "Full access to this gateway"}}, "next_cursor": nil})
	case path == "playground:send" && r.Method == http.MethodPost:
		a.playground(w, r)
	case path == "guardrails:test" && r.Method == http.MethodPost:
		a.guardTest(w, r, "")
	case path == "providers:test" && r.Method == http.MethodPost:
		a.providerTest(w, r, "")
	case path == "provider-presets" && r.Method == http.MethodGet:
		a.providerPresets(w, r)
	case strings.HasPrefix(path, "provider-presets/") && strings.HasSuffix(path, ":install") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "provider-presets/"), ":install")
		a.installPreset(w, r, id)
	case path == "routing/strategies" && r.Method == http.MethodGet:
		a.routingStrategies(w)
	case path == "runtime/quotas" && r.Method == http.MethodGet:
		a.runtimeQuotas(w)
	case path == "clients" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"items": clientsList()})
	case strings.HasPrefix(path, "clients/") && r.Method == http.MethodGet:
		a.clientSnippet(w, strings.TrimPrefix(path, "clients/"))
	case strings.HasPrefix(path, "settings/"):
		a.settings(w, r, strings.TrimPrefix(path, "settings/"))
	default:
		if a.action(w, r, path) {
			return
		}
		if col, name, ok := splitCollection(path); ok {
			a.collection(w, r, col, name)
			return
		}
		writeErr(w, http.StatusNotFound, "not_found", "No such admin operation.")
	}
}

func (a *API) action(w http.ResponseWriter, r *http.Request, path string) bool {
	if !strings.Contains(path, ":") || r.Method != http.MethodPost {
		return false
	}
	base, act, _ := strings.Cut(path, ":")
	switch {
	case strings.HasPrefix(base, "providers/") && act == "test":
		a.providerTest(w, r, strings.TrimPrefix(base, "providers/"))
	case strings.HasPrefix(base, "providers/") && act == "rotate_credential":
		a.rotateCredential(w, r, strings.TrimPrefix(base, "providers/"))
	case strings.HasPrefix(base, "guardrails/") && act == "test":
		a.guardTest(w, r, strings.TrimPrefix(base, "guardrails/"))
	case strings.HasPrefix(base, "routes/") && act == "simulate":
		a.simulate(w, r, strings.TrimPrefix(base, "routes/"))
	case strings.HasPrefix(base, "change_requests/") && (act == "approve" || act == "apply" || act == "cancel"):
		a.changeAction(w, r, strings.TrimPrefix(base, "change_requests/"), act)
	case strings.HasPrefix(base, "keys/") && act == "rotate":
		a.rotateKey(w, strings.TrimPrefix(base, "keys/"))
	case strings.HasPrefix(base, "alerts/channels/") && act == "test":
		a.testChannel(w, strings.TrimPrefix(base, "alerts/channels/"))
	default:
		return false
	}
	return true
}

func splitCollection(path string) (col, name string, ok bool) {
	cols := []string{
		"cache/invalidation_rules", "alerts/channels", "alerts/rules", "mcp/servers", "mcp/gateways",
		"a2a/agents", "logs/views", "change_requests", "role_bindings", "providers", "models", "deployments",
		"routes", "keys", "organizations", "teams", "projects", "users", "guardrails", "plugins", "invitations",
		"combos", "memories",
	}
	for _, c := range cols {
		if path == c {
			return c, "", true
		}
		if strings.HasPrefix(path, c+"/") {
			return c, strings.TrimPrefix(path, c+"/"), true
		}
	}
	return "", "", false
}

func (a *API) collection(w http.ResponseWriter, r *http.Request, col, name string) {
	if a.held(w, r, col) {
		return
	}
	switch {
	case name == "" && r.Method == http.MethodGet:
		list, err := a.Store.List(col)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items := make([]any, 0, len(list))
		for _, res := range list {
			items = append(items, represent(res))
		}
		body := map[string]any{"items": items, "next_cursor": nil}
		if col == "keys" || col == "users" {
			body["counts"] = map[string]any{}
		}
		writeJSON(w, http.StatusOK, body)
	case name == "" && r.Method == http.MethodPost:
		var body map[string]any
		if err := readBody(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
		resName := asString(body["name"])
		spec := asMap(body["spec"])
		if resName == "" || spec == nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", "name and spec are required")
			return
		}
		res, err := a.Store.Put(col, resName, spec, "", false)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		a.Store.AddAudit(map[string]any{"action": "create", "resource": col + "/" + resName, "at": nowRFC()})
		out := represent(res)
		if res.Once != "" {
			out["secret"] = res.Once
		}
		writeJSON(w, http.StatusCreated, out)
	case name != "" && r.Method == http.MethodGet:
		if strings.Contains(name, "/") {
			writeErr(w, http.StatusNotFound, "not_found", "No such resource.")
			return
		}
		res, err := a.Store.Get(col, name)
		if errors.Is(err, ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "No such resource.")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, represent(res))
	case name != "" && (r.Method == http.MethodPut || r.Method == http.MethodPatch):
		var body map[string]any
		if err := readBody(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
		spec := asMap(body["spec"])
		if spec == nil {
			spec = body
		}
		res, err := a.Store.Put(col, name, spec, r.Header.Get("If-Match"), r.Method == http.MethodPatch)
		if errors.Is(err, ErrNotFound) && r.Method == http.MethodPut {
			res, err = a.Store.Put(col, name, spec, "", false)
		}
		if errors.Is(err, ErrPrecondition) {
			writeErr(w, http.StatusPreconditionFailed, "precondition_failed", "It changed since you read it. Reload to see the current version.")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		a.Store.AddAudit(map[string]any{"action": "update", "resource": col + "/" + name, "at": nowRFC()})
		writeJSON(w, http.StatusOK, represent(res))
	case name != "" && r.Method == http.MethodDelete:
		err := a.Store.Delete(col, name, r.Header.Get("If-Match"))
		if errors.Is(err, ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "No such resource.")
			return
		}
		if errors.Is(err, ErrPrecondition) {
			writeErr(w, http.StatusPreconditionFailed, "precondition_failed", "It changed since you read it. Reload to see the current version.")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		a.Store.AddAudit(map[string]any{"action": "delete", "resource": col + "/" + name, "at": nowRFC()})
		w.WriteHeader(http.StatusNoContent)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "That method is not allowed here.")
	}
}

func (a *API) held(w http.ResponseWriter, r *http.Request, col string) bool {
	if r.Method == http.MethodGet || col == "change_requests" || col == "settings" {
		return false
	}
	res, err := a.Store.Get("settings", "governance")
	if err != nil {
		return false
	}
	cc := asMap(res.Spec["change_control"])
	if cc["enabled"] != true {
		return false
	}
	writeErr(w, http.StatusConflict, "change_request_required", "This change needs a change request.")
	return true
}

func (a *API) settings(w http.ResponseWriter, r *http.Request, name string) {
	name = strings.TrimSuffix(name, "/")
	switch r.Method {
	case http.MethodGet:
		res, err := a.Store.Get("settings", name)
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"spec": map[string]any{}, "metadata": metaNow(a.Store.Generation())})
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"spec": res.Spec, "metadata": resourceMeta(res)})
	case http.MethodPut, http.MethodPatch:
		var body map[string]any
		if err := readBody(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
		spec := asMap(body["spec"])
		if spec == nil {
			spec = map[string]any{}
		}
		res, err := a.Store.Put("settings", name, spec, r.Header.Get("If-Match"), r.Method == http.MethodPatch)
		if errors.Is(err, ErrPrecondition) {
			writeErr(w, http.StatusPreconditionFailed, "precondition_failed", "It changed since you read it. Reload to see the current version.")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		a.Store.AddAudit(map[string]any{"action": "update", "resource": "settings/" + name, "at": nowRFC()})
		writeJSON(w, http.StatusOK, map[string]any{"spec": res.Spec, "metadata": resourceMeta(res)})
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "That method is not allowed here.")
	}
}

func (a *API) session(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := readBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	token := asString(body["token"])
	password := asString(body["password"])
	email := asString(body["email"])
	a.acceptLogin(w, token, email, password, clientIP(r))
}

func (a *API) preferences(w http.ResponseWriter, r *http.Request) {
	const id = "bootstrap"
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, a.Store.Preferences(id))
	case http.MethodPut:
		var body map[string]any
		if err := readBody(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
		if body == nil {
			body = map[string]any{}
		}
		a.Store.SetPreferences(id, body)
		writeJSON(w, http.StatusOK, body)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "That method is not allowed here.")
	}
}

func (a *API) status(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version": a.Version, "commit": "wowrouter", "mode": "standalone", "test_mode": false,
		"config_generation": a.Store.Generation(), "config_hash": "local",
		"nodes": []any{map[string]any{"id": "wowrouter", "generation": a.Store.Generation(), "last_seen": nowRFC()}},
		"features": []string{
			"routing", "budgets", "guardrails", "cache", "request_log", "mcp", "agents", "alerts", "audit",
		},
		"data_plane_url": "http://127.0.0.1:8787/v1",
		"console":        map[string]any{"enabled": true, "path": "/ui/"},
		"users":          map[string]any{"active": 1, "cap": nil},
	})
}

func (a *API) health(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "draining": false,
		"dependencies":  map[string]any{"sqlite": map[string]any{"status": "up", "since": nil, "last_error": nil, "latency_ms": 0}},
		"admission":     map[string]any{"in_flight": 0, "queued": 0, "max_in_flight": 1024, "max_queue": 0},
		"spool":         map[string]any{"bytes": 0, "max_bytes": 0, "records": 0},
		"config":        map[string]any{"generation": a.Store.Generation(), "hash": "local"},
		"clock_skew_ms": nil,
	})
}

func (a *API) node() map[string]any {
	return map[string]any{
		"node_id": "wowrouter", "id": "wowrouter", "version": a.Version, "config_version": a.Store.Generation(),
		"ready": true, "draining": false, "degraded": []any{}, "last_seen": nowRFC(),
		"in_flight": 0, "max_in_flight": 1024, "queue_depth": 0,
		"started_at": nowRFC(), "ready_since": nowRFC(), "generation": a.Store.Generation(),
	}
}

func (a *API) logs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	items := a.Store.Logs(q.Get("from"), q.Get("to"), 200)
	if model := q.Get("model"); model != "" {
		items = filterLogs(items, "model", model)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func filterLogs(items []map[string]any, key, want string) []map[string]any {
	var out []map[string]any
	for _, item := range items {
		if asString(item[key]) == want {
			out = append(out, item)
		}
	}
	return out
}

func (a *API) usage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	logs := a.Store.Logs(q.Get("from"), q.Get("to"), 5000)
	groups := q["group_by"]
	type acc struct {
		requests, errors, input, output, cache int
		cost                                   float64
		lat                                    []float64
	}
	bucket := map[string]*acc{}
	for _, rec := range logs {
		if q.Get("flagged") == "true" && len(asSlice(rec["guardrails"])) == 0 {
			continue
		}
		group := map[string]any{}
		for _, g := range groups {
			group[g] = rec[g]
		}
		raw, _ := json.Marshal(group)
		row := bucket[string(raw)]
		if row == nil {
			row = &acc{}
			bucket[string(raw)] = row
		}
		row.requests++
		if int(asFloat(rec["status_code"])) >= 400 {
			row.errors++
		}
		usage := asMap(rec["usage"])
		row.input += int(asFloat(usage["input"]))
		row.output += int(asFloat(usage["output"]))
		row.cost += asFloat(asMap(rec["cost"])["usd"])
		if asMap(rec["cache"])["hit"] == true {
			row.cache++
		}
		row.lat = append(row.lat, asFloat(asMap(rec["timing"])["total_ms"]))
	}
	items := []any{}
	start := q.Get("from")
	if start == "" {
		start = nowRFC()
	}
	keys := make([]string, 0, len(bucket))
	for k := range bucket {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		row := bucket[k]
		var group map[string]any
		_ = json.Unmarshal([]byte(k), &group)
		sort.Float64s(row.lat)
		p50 := pct(row.lat, 0.5)
		items = append(items, map[string]any{
			"start": start, "group": group, "requests": row.requests, "errors": row.errors,
			"input": row.input, "output": row.output, "cost_usd": money(row.cost),
			"latency_ms": map[string]any{"p50": p50, "p90": pct(row.lat, 0.9), "p95": pct(row.lat, 0.95), "p99": pct(row.lat, 0.99)},
			"cache_hits": row.cache, "cache_saved_usd": money(0),
		})
	}
	if len(items) == 0 {
		items = append(items, map[string]any{
			"start": start, "group": map[string]any{}, "requests": 0, "errors": 0, "cost_usd": "0.000000",
			"latency_ms": map[string]any{"p50": 0, "p95": 0, "p99": 0},
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(float64(len(sorted)-1) * p)
	return sorted[i]
}

func (a *API) pressure(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from := q.Get("from")
	to := q.Get("to")
	if from == "" {
		from = nowRFC()
	}
	if to == "" {
		to = nowRFC()
	}
	writeJSON(w, http.StatusOK, map[string]any{"from": from, "to": to, "interval": nil, "threshold": 0.8, "items": []any{}, "hot": []any{}})
}

func (a *API) tiers(w http.ResponseWriter) {
	seen := map[string]int{}
	for _, model := range a.Store.Resources("models") {
		if tier := asString(model.Spec["tier"]); tier != "" {
			seen[tier]++
		}
	}
	items := []any{}
	for name, n := range seen {
		items = append(items, map[string]any{"name": name, "builtin": false, "models": n})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) runtimeProviders(w http.ResponseWriter) {
	items := []any{}
	for _, p := range a.Store.Resources("providers") {
		state := "none"
		if asString(asMap(p.Private["auth"])["api_key"]) != "" {
			state = "valid"
		}
		items = append(items, map[string]any{
			"name": p.Name, "type": asString(p.Spec["type"]),
			"credential": map[string]any{"method": "api_key", "state": state, "expires_at": nil, "last_error": nil},
			"tls_verify": true,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) runtimeDeployments(w http.ResponseWriter) {
	items := []any{}
	for _, d := range a.Store.Resources("deployments") {
		state, failures, openTill := a.Engine.Breakers.Snapshot(d.Name)
		var until any
		if !openTill.IsZero() {
			until = openTill.UTC().Format(time.RFC3339)
		}
		items = append(items, map[string]any{
			"name": d.Name, "state": state, "open_until": until, "trips": 0, "consecutive": failures,
			"window":         map[string]any{"requests": 0, "failures": failures},
			"cooldown_until": nil, "disabled_until": nil, "keys": []any{},
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) runtimeGuardrails(w http.ResponseWriter) {
	items := []any{}
	for _, g := range a.Store.Resources("guardrails") {
		items = append(items, map[string]any{"name": g.Name, "enabled": g.Spec["enabled"] != false, "type": asString(g.Spec["type"])})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) budgets(w http.ResponseWriter) {
	items := []any{}
	now := time.Now()
	add := func(level, owner string, spec map[string]any) {
		for _, b := range gateway.BudgetsOf(level, owner, spec) {
			spent := a.Store.SpendOf(gateway.Bucket(b.Level, b.Owner, b.Name, b.Period, now))
			state := "on_pace"
			if b.Amount > 0 && spent >= b.Amount {
				state = "over"
			} else if b.Amount > 0 && spent/b.Amount >= 0.8 {
				state = "at_risk"
			}
			items = append(items, map[string]any{
				"level": level, "owner": owner, "name": b.Name, "partition": nil,
				"unit": or(b.Unit, "usd"), "mode": b.Mode, "amount": money(b.Amount), "spent": money(spent),
				"reserved": "0", "remaining": money(b.Amount - spent),
				"period_start": gateway.PeriodStart(b.Period, now).UTC().Format(time.RFC3339),
				"resets_at":    nil, "state": state,
			})
		}
	}
	for _, level := range []struct{ level, col string }{{"organization", "organizations"}, {"team", "teams"}, {"project", "projects"}, {"key", "keys"}} {
		for _, res := range a.Store.Resources(level.col) {
			add(level.level, res.Name, res.Spec)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) prices(w http.ResponseWriter) {
	items := []any{}
	for _, d := range a.Store.Resources("deployments") {
		price := asMap(d.Spec["price"])
		items = append(items, map[string]any{"name": d.Name, "price": price, "source": "deployment"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) alerts(w http.ResponseWriter, r *http.Request) {
	items := a.Store.Alerts()
	if r.URL.Query().Get("status") != "" {
		want := r.URL.Query()["status"]
		var filtered []map[string]any
		for _, alert := range items {
			for _, s := range want {
				if asString(alert["status"]) == s {
					filtered = append(filtered, alert)
				}
			}
		}
		items = filtered
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (a *API) alertAction(w http.ResponseWriter, r *http.Request, path string) {
	base, act, _ := strings.Cut(strings.TrimPrefix(path, "alerts/"), ":")
	var found map[string]any
	for _, alert := range a.Store.Alerts() {
		if asString(alert["id"]) == base {
			found = alert
			break
		}
	}
	if found == nil {
		writeErr(w, http.StatusNotFound, "not_found", "No alert with that id.")
		return
	}
	switch act {
	case "acknowledge":
		found["status"] = "acknowledged"
		found["acknowledged_at"] = nowRFC()
	case "resolve":
		found["status"] = "resolved"
		found["resolved_at"] = nowRFC()
	case "unsnooze":
		found["snoozed_until"] = nil
	case "snooze":
		found["snoozed_until"] = time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	case "note", "escalate":
	default:
		writeErr(w, http.StatusNotFound, "not_found", "No such alert action.")
		return
	}
	a.Store.PutAlert(found)
	writeJSON(w, http.StatusOK, found)
}

func (a *API) playground(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	bodyAny, err := decodeJSON(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	body := asMap(bodyAny)
	if inner := asMap(body["request"]); inner != nil && body["messages"] == nil {
		body = inner
	}
	model := asString(body["model"])
	out := a.Engine.Handle(gateway.Call{Model: model, Body: body, Dialect: "openai"})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(out.Status)
	_, _ = w.Write(out.Body)
}

func (a *API) guardTest(w http.ResponseWriter, r *http.Request, name string) {
	var body map[string]any
	if err := readBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	text := asString(body["text"])
	if text == "" {
		text = asString(asMap(body["input"])["text"])
	}
	rules := a.Store.Resources("guardrails")
	if spec := asMap(body["spec"]); spec != nil {
		rules = []gateway.Named{{Name: or(asString(body["name"]), "draft"), Spec: spec}}
	} else if name != "" {
		var one []gateway.Named
		for _, rule := range rules {
			if rule.Name == name {
				one = append(one, rule)
			}
		}
		rules = one
	}
	stage := asString(body["stage"])
	if stage == "" {
		stage = asString(asMap(body["input"])["stage"])
	}
	if stage == "" {
		stage = "input"
	}
	got := gateway.Apply(rules, text, stage)
	verdict := "allow"
	if got.Blocked {
		verdict = "block"
	} else if len(got.Hits) > 0 {
		verdict = "flag"
	}
	var spans []any
	category := ""
	for _, hit := range got.Hits {
		category = hit.Category
		spans = append(spans, map[string]any{"start": 0, "end": len(text), "entity": hit.Detail})
	}
	if spans == nil {
		spans = []any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"verdict": verdict, "category": category, "redacted": got.Text, "spans": spans})
}

func (a *API) providerTest(w http.ResponseWriter, r *http.Request, name string) {
	started := time.Now()
	var body map[string]any
	_ = readBody(r, &body)
	spec := asMap(body["spec"])
	if name != "" {
		if res, err := a.Store.Get("providers", name); err == nil {
			if spec == nil {
				spec = res.Private
			} else if kept, ok := keepSecrets(res.Private, spec).(map[string]any); ok {
				spec = kept
			}
		}
	}
	base := asString(spec["base_url"])
	if base == "" {
		base = providerDefaultBase(asString(spec["type"]))
	}
	key := asString(asMap(spec["auth"])["api_key"])
	result := map[string]any{"ok": false, "method": "list_models", "status_code": nil, "latency_ms": 0, "error": nil, "models": nil, "tested_at": nowRFC()}
	if base == "" {
		result["error"] = "no base URL"
		writeJSON(w, http.StatusOK, result)
		return
	}
	if err := gateway.SafeHTTPURL(base); err != nil {
		result["error"] = err.Error()
		writeJSON(w, http.StatusOK, result)
		return
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(base, "/")+"/models", nil)
	if err != nil {
		result["error"] = err.Error()
		writeJSON(w, http.StatusOK, result)
		return
	}
	if key != "" && key != "[REDACTED]" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	result["latency_ms"] = time.Since(started).Milliseconds()
	if err != nil {
		result["error"] = err.Error()
		writeJSON(w, http.StatusOK, result)
		return
	}
	defer resp.Body.Close()
	result["status_code"] = resp.StatusCode
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		result["error"] = string(raw)
		writeJSON(w, http.StatusOK, result)
		return
	}
	var listed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(raw, &listed)
	models := []any{}
	for _, m := range listed.Data {
		models = append(models, map[string]any{"id": m.ID, "name": m.ID, "listed_by_provider": true, "context_window": nil, "max_output_tokens": nil, "modalities": map[string]any{"input": []any{"text"}, "output": []any{"text"}}, "price": nil, "price_source": nil, "release_date": nil})
	}
	result["ok"] = true
	result["models"] = models
	writeJSON(w, http.StatusOK, result)
}

func (a *API) simulate(w http.ResponseWriter, r *http.Request, name string) {
	var body map[string]any
	_ = readBody(r, &body)
	spec := asMap(body["spec"])
	if spec == nil {
		if res, err := a.Store.Get("routes", name); err == nil {
			spec = res.Spec
		}
	}
	logs := a.Store.Logs("", "", 500)
	if len(logs) == 0 {
		logs = []map[string]any{{"model": name}}
	}
	counts := map[string]int{}
	blocked := 0
	for _, rec := range logs {
		facts := gateway.Facts{Text: asString(asMap(rec["content"])["text"]), Key: asString(rec["key"]), Team: asString(rec["team"])}
		leaves, block := gateway.Plan(asMap(spec["tree"]), a.Store, facts)
		if block {
			blocked++
			continue
		}
		if len(leaves) == 0 {
			continue
		}
		counts[leaves[0].Deployment]++
	}
	byLeaf := []any{}
	for dep, n := range counts {
		byLeaf = append(byLeaf, map[string]any{"path": dep, "deployment": dep, "count": n})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"evaluated": len(logs), "matched_by_rule": []any{}, "by_leaf": byLeaf, "blocked": blocked, "no_route": 0,
	})
}

func (a *API) changeAction(w http.ResponseWriter, r *http.Request, id, act string) {
	res, err := a.Store.Get("change_requests", id)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "No such change request.")
		return
	}
	spec := cloneMap(res.Spec)
	switch act {
	case "approve":
		spec["state"] = "approved"
	case "cancel":
		spec["state"] = "cancelled"
	case "apply":
		spec["state"] = "applied"
		spec["applied_at"] = nowRFC()
	}
	saved, err := a.Store.Put("change_requests", id, spec, "", false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, represent(saved))
}

func (a *API) rotateKey(w http.ResponseWriter, name string) {
	res, err := a.Store.Get("keys", name)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "No such key.")
		return
	}
	spec := cloneMap(res.Private)
	delete(spec, "secret_sha256")
	delete(spec, "secret_hint")
	saved, err := a.Store.Put("keys", name, spec, "", false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := represent(saved)
	out["secret"] = saved.Once
	writeJSON(w, http.StatusOK, out)
}

func represent(res Resource) map[string]any {
	meta := resourceMeta(res)
	if hint := asString(res.Private["secret_hint"]); hint != "" {
		meta["hint"] = hint
	}
	spec := cloneMap(res.Spec)
	delete(spec, "secret_sha256")
	return map[string]any{"name": res.Name, "spec": spec, "metadata": meta}
}

func resourceMeta(res Resource) map[string]any {
	return map[string]any{
		"etag": res.ETag, "generation": res.Generation, "created_at": res.CreatedAt, "updated_at": res.UpdatedAt, "managed_by": or(res.ManagedBy, "api"),
	}
}

func metaNow(gen int64) map[string]any {
	t := nowRFC()
	return map[string]any{"etag": `"g0"`, "generation": gen, "created_at": t, "updated_at": t, "managed_by": "api"}
}

func me() map[string]any {
	perms := []string{
		"analytics:read", "alerts:read", "alerts:write", "audit:read", "cache:read", "cache:admin",
		"cluster:read", "deployments:read", "deployments:write", "config:read", "config:write", "config:apply",
		"guardrails:read", "health:read", "health:write", "keys:read", "keys:write", "keys:grant_permissions",
		"logs:read", "logs:read_content", "logs:delete", "mcp:read", "mcp:write", "models:read", "models:write",
		"organizations:read", "organizations:write", "playground:send", "plugins:read", "plugins:write",
		"policies:read", "policies:write", "pricing:read", "pricing:write", "projects:read", "projects:write",
		"providers:read", "providers:write", "role_bindings:read", "role_bindings:write", "security:read", "security:write",
		"teams:read", "teams:write", "users:read", "users:write", "budgets:adjust", "safety:review", "notifications:send", "node:drain",
	}
	return map[string]any{
		"principal":    map[string]any{"type": "bootstrap", "id": "bootstrap", "kind": "human", "authenticated_by": "session"},
		"bindings":     []any{map[string]any{"id": "rb-bootstrap", "principal": map[string]any{"type": "bootstrap", "id": "bootstrap"}, "role": "gateway_admin", "scope": "gateway"}},
		"permissions":  map[string]any{"gateway": perms},
		"session":      nil,
		"user":         map[string]any{"name": "admin", "display_name": "Admin"},
		"token_policy": map[string]any{"max_lifetime": "90d", "default_lifetime": "30d"},
	}
}

func providerTypes() []any {
	type row struct {
		Type, URL string
		Auth      []string
		Dialects  []string
	}
	rows := []row{
		{"openai", "https://api.openai.com/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"azure_openai", "", []string{"api_key"}, []string{"openai_chat"}},
		{"anthropic", "https://api.anthropic.com", []string{"api_key"}, []string{"anthropic_messages"}},
		{"bedrock", "https://bedrock-runtime.{region}.amazonaws.com", []string{"aws_sigv4", "api_key"}, []string{"bedrock_converse"}},
		{"vertex", "", []string{"gcp"}, []string{"gemini"}},
		{"gemini", "https://generativelanguage.googleapis.com/v1beta", []string{"api_key"}, []string{"gemini"}},
		{"mistral", "https://api.mistral.ai/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"cohere", "https://api.cohere.ai/compatibility/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"groq", "https://api.groq.com/openai/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"together", "https://api.together.xyz/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"fireworks", "https://api.fireworks.ai/inference/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"deepseek", "https://api.deepseek.com/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"xai", "https://api.x.ai/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"cerebras", "https://api.cerebras.ai/v1", []string{"api_key"}, []string{"openai_chat"}},
		{"deepinfra", "https://api.deepinfra.com/v1/openai", []string{"api_key"}, []string{"openai_chat"}},
		{"perplexity", "https://api.perplexity.ai", []string{"api_key"}, []string{"openai_chat"}},
		{"openai_compatible", "", []string{"api_key", "none"}, []string{"openai_chat"}},
		{"anthropic_compatible", "", []string{"api_key"}, []string{"anthropic_messages"}},
	}
	seen := map[string]bool{}
	out := []any{}
	add := func(typ, url string, auth, dialects []string, core bool) {
		if seen[typ] {
			return
		}
		seen[typ] = true
		var base any = url
		if url == "" {
			base = nil
		}
		out = append(out, map[string]any{"type": typ, "core": core, "default_base_url": base, "dialects": dialects, "auth_methods": auth})
	}
	for _, row := range rows {
		add(row.Type, row.URL, row.Auth, row.Dialects, true)
	}
	for _, p := range catalogdata.Providers() {
		add(p.ID, p.API, []string{"api_key"}, []string{catalogdata.Dialect(p.ID)}, false)
	}
	return out
}

func providerDefaultBase(ptype string) string {
	switch ptype {
	case "openai":
		return "https://api.openai.com/v1"
	case "groq":
		return "https://api.groq.com/openai/v1"
	case "anthropic":
		return "https://api.anthropic.com/v1"
	default:
		return ""
	}
}

func or(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func readBody(r *http.Request, dest *map[string]any) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		*dest = map[string]any{}
		return nil
	}
	v, err := decodeJSON(raw)
	if err != nil {
		return err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return errors.New("expected a JSON object")
	}
	*dest = m
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(body)
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}

func (a *API) providerModels(w http.ResponseWriter, r *http.Request, name string) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	wantID := strings.TrimSpace(r.URL.Query().Get("id"))
	p, ok := catalogdata.ByID(name)
	if !ok {
		// A saved provider may use a type name that matches the directory.
		if res, err := a.Store.Get("providers", name); err == nil {
			if alt, ok := catalogdata.ByID(asString(res.Spec["type"])); ok {
				p = alt
				ok = true
			}
		}
	}
	items := []any{}
	if ok {
		for _, m := range p.Models {
			if wantID != "" && m.ID != wantID {
				continue
			}
			if q != "" && !strings.Contains(strings.ToLower(m.ID), q) && !strings.Contains(strings.ToLower(m.Name), q) {
				continue
			}
			var price any
			if m.Input != 0 || m.Output != 0 {
				price = map[string]any{"input": trimFloat(m.Input), "output": trimFloat(m.Output), "cache_read": nil, "cache_write": nil}
			}
			var ctx, max any
			if m.Context > 0 {
				ctx = m.Context
			}
			if m.MaxOut > 0 {
				max = m.MaxOut
			}
			items = append(items, map[string]any{
				"id": m.ID, "name": m.Name, "listed_by_provider": false,
				"context_window": ctx, "max_output_tokens": max,
				"modalities": nil, "price": price, "price_source": "catalog", "release_date": nil,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "source": "catalog", "fetched_at": nil, "error": nil})
}

func trimFloat(v float64) string {
	s := strconv.FormatFloat(v, 'f', -1, 64)
	return s
}

func (a *API) rotateCredential(w http.ResponseWriter, r *http.Request, name string) {
	var body map[string]any
	if err := readBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	res, err := a.Store.Get("providers", name)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "No such provider.")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	secret := asString(body["credential"])
	if secret == "" {
		writeErr(w, http.StatusBadRequest, "invalid_body", "credential is required")
		return
	}
	spec := cloneMap(res.Private)
	if spec == nil {
		spec = map[string]any{}
	}
	auth := asMap(spec["auth"])
	if auth == nil {
		auth = map[string]any{}
	}
	keyName := asString(body["key"])
	if keys := asSlice(auth["api_keys"]); len(keys) > 0 && keyName != "" {
		for i, item := range keys {
			row := asMap(item)
			if asString(row["name"]) == keyName {
				row["key"] = secret
				keys[i] = row
			}
		}
		auth["api_keys"] = keys
	} else if keyName != "" && keyName != "default" {
		auth["api_keys"] = append(asSlice(auth["api_keys"]), map[string]any{"name": keyName, "key": secret, "weight": 1})
	} else {
		auth["api_key"] = secret
		auth["method"] = or(asString(auth["method"]), "api_key")
	}
	spec["auth"] = auth
	saved, err := a.Store.Put("providers", name, spec, "", false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	a.Store.AddAudit(map[string]any{"action": "rotate_credential", "resource": "providers/" + name, "at": nowRFC()})
	writeJSON(w, http.StatusOK, represent(saved))
}
