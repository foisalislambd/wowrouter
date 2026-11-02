package admin

import (
	"net/http"
	"strings"

	"wowrouter/server/internal/clients"
	"wowrouter/server/internal/combo"
	"wowrouter/server/internal/compress"
	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/presets"
)

func (a *API) providerPresets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	freeOnly := r.URL.Query().Get("free") == "1" || r.URL.Query().Get("free") == "true"
	items := presets.Search(q, freeOnly)
	out := make([]any, 0, len(items))
	for _, p := range items {
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": presets.Count(), "items": out})
}

func (a *API) installPreset(w http.ResponseWriter, r *http.Request, id string) {
	p, ok := presets.ByID(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "No preset with that id.")
		return
	}
	if !p.Supported {
		writeErr(w, http.StatusBadRequest, "unsupported", p.Reason)
		return
	}
	if !p.HTTP() {
		writeErr(w, http.StatusBadRequest, "no_http_base", "This preset has no HTTP base URL. It needs a browser login or a custom endpoint.")
		return
	}
	var body map[string]any
	if r != nil {
		if err := readBody(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", "The install body must be a JSON object.")
			return
		}
	}
	if _, err := a.Store.Get("providers", p.ID); err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"provider": p.ID, "installed": true, "existed": true})
		return
	}
	base := p.BaseURL
	format := p.Format
	ptype := presetType(format, base)
	authStyle := p.Auth
	note := ""
	if len(p.Needs) > 0 {
		built, builtFormat, builtType, builtNote, err := presets.VertexEndpoint(p.ID, asString(body["project_id"]), asString(body["region"]))
		if err != nil {
			writeErr(w, http.StatusBadRequest, "project_required", err.Error())
			return
		}
		base, format, ptype, note = built, builtFormat, builtType, builtNote
		authStyle = "bearer"
	}
	if ptype == "" {
		writeErr(w, http.StatusBadRequest, "unsupported", "This preset has no chat adapter.")
		return
	}
	auth := map[string]any{}
	token := strings.TrimSpace(asString(body["access_token"]))
	sa := strings.TrimSpace(asString(body["service_account_json"]))
	if sa != "" {
		if err := gateway.ValidateServiceAccount(sa); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_service_account", err.Error())
			return
		}
		auth["service_account_json"] = sa
	}
	if token != "" {
		auth["api_key"] = token
	}
	authRequired := len(p.Needs) > 0 && token == "" && sa == ""
	spec := map[string]any{
		"type":          ptype,
		"base_url":      base,
		"enabled":       true,
		"free":          p.Free,
		"preset":        p.ID,
		"format":        format,
		"auth_style":    authStyle,
		"auth":          auth,
		"auth_required": authRequired,
	}
	if note != "" {
		spec["notes"] = note
	} else if p.Free {
		spec["notes"] = "Free tier preset. Add a key only if the provider asks for one."
	}
	if authRequired {
		spec["notes"] = asString(spec["notes"]) + " A Bearer access token or service account JSON is still required before a call succeeds."
	}
	if _, err := a.Store.Put("providers", p.ID, spec, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	dep := ""
	if len(p.Models) > 0 {
		dep = p.ID + "-" + sanitizeName(p.Models[0])
		_, _ = a.Store.Put("deployments", dep, map[string]any{
			"provider": p.ID,
			"model":    p.Models[0],
			"enabled":  true,
			"weight":   1,
		}, "", false)
	}
	a.Store.AddAudit(map[string]any{"action": "install_preset", "resource": "providers/" + p.ID, "at": nowRFC()})
	writeJSON(w, http.StatusCreated, map[string]any{
		"provider": p.ID, "deployment": dep, "installed": true,
		"base_url": base, "auth_required": authRequired,
	})
}

func presetType(format, base string) string {
	switch strings.ToLower(format) {
	case "claude", "anthropic":
		return "anthropic"
	case "gemini":
		return "gemini"
	case "custom", "unsupported":
		return ""
	}
	if strings.Contains(strings.ToLower(base), "://api.anthropic.com") {
		return "anthropic"
	}
	return "openai_compatible"
}

func sanitizeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else if r == '/' || r == ':' || r == ' ' {
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "model"
	}
	if len(out) > 48 {
		out = out[:48]
	}
	return out
}

func (a *API) routingStrategies(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"strategies":  combo.Strategies(),
		"auto_models": combo.AutoModels(),
		"compression": map[string]any{
			"engines":         compress.Engines(),
			"not_implemented": compress.NotImplemented(),
			"profiles":        []string{"off", "lite", "standard", "aggressive", "rtk"},
		},
	})
}

func (a *API) runtimeQuotas(w http.ResponseWriter) {
	var items []map[string]any
	if a.Engine != nil && a.Engine.Breakers != nil {
		items = a.Engine.Breakers.SnapshotAll()
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func clientsList() []string { return clients.Names() }

func (a *API) clientSnippet(w http.ResponseWriter, name string) {
	file, body, ok := clients.Snippet(name, "http://127.0.0.1:8787", "sk-wowrouter-YOUR-KEY")
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "Unknown client. Use claude, codex, cursor, cline, opencode, or copilot.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"client": name, "file": file, "body": body})
}
