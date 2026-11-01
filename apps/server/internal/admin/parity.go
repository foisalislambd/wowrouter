package admin

import (
	"net/http"
	"strings"

	"wowrouter/server/internal/clients"
	"wowrouter/server/internal/combo"
	"wowrouter/server/internal/compress"
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

func (a *API) installPreset(w http.ResponseWriter, id string) {
	p, ok := presets.ByID(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "No preset with that id.")
		return
	}
	if !p.HTTP() {
		writeErr(w, http.StatusBadRequest, "no_http_base", "This preset has no HTTP base URL. It needs a browser login or a custom endpoint.")
		return
	}
	if _, err := a.Store.Get("providers", p.ID); err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"provider": p.ID, "installed": true, "existed": true})
		return
	}
	spec := map[string]any{
		"type":       presetType(p.Format, p.BaseURL),
		"base_url":   p.BaseURL,
		"enabled":    true,
		"free":       p.Free,
		"preset":     p.ID,
		"auth_style": p.Auth,
		"auth":       map[string]any{},
	}
	if p.Free {
		spec["notes"] = "Free tier preset. Add a key only if the provider asks for one."
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
	writeJSON(w, http.StatusCreated, map[string]any{"provider": p.ID, "deployment": dep, "installed": true})
}

func presetType(format, base string) string {
	switch strings.ToLower(format) {
	case "claude", "anthropic":
		return "anthropic"
	case "gemini":
		return "gemini"
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
