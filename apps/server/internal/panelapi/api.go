package panelapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"time"

	"wowrouter/server/desktoppref"
	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/gateway"
)

type Handler struct {
	Store   *admin.Store
	DataDir string
	Addr    string
	mux     *http.ServeMux
}

func New(store *admin.Store, dataDir, addr string) *Handler {
	h := &Handler{Store: store, DataDir: dataDir, Addr: addr, mux: http.NewServeMux()}
	h.mux.HandleFunc("POST /api/login", h.login)
	h.mux.HandleFunc("POST /api/logout", h.logout)
	h.mux.HandleFunc("GET /api/session", h.session)
	h.mux.HandleFunc("GET /api/overview", h.overview)
	h.mux.HandleFunc("GET /api/providers", h.providers)
	h.mux.HandleFunc("GET /api/providers/{slug}", h.provider)
	h.mux.HandleFunc("PUT /api/providers/{slug}", h.saveProvider)
	h.mux.HandleFunc("GET /api/providers/{slug}/accounts", h.accounts)
	h.mux.HandleFunc("POST /api/providers/{slug}/accounts", h.createAccount)
	h.mux.HandleFunc("PUT /api/providers/{slug}/accounts/{id}", h.saveAccount)
	h.mux.HandleFunc("DELETE /api/providers/{slug}/accounts/{id}", h.deleteAccount)
	h.mux.HandleFunc("POST /api/providers/{slug}/test", h.testProvider)
	h.mux.HandleFunc("POST /api/providers/{slug}/models/load", h.loadModels)
	h.mux.HandleFunc("GET /api/providers/{slug}/models", h.providerModels)
	h.mux.HandleFunc("PUT /api/providers/{slug}/models/{upstream...}", h.setModel)
	h.mux.HandleFunc("GET /api/models", h.activeModels)
	h.mux.HandleFunc("GET /api/keys", h.keys)
	h.mux.HandleFunc("POST /api/keys", h.createKey)
	h.mux.HandleFunc("DELETE /api/keys/{id}", h.deleteKey)
	h.mux.HandleFunc("PUT /api/keys/{id}/limits", h.keyLimits)
	h.mux.HandleFunc("GET /api/activity", h.activity)
	h.mux.HandleFunc("DELETE /api/activity", h.clearActivity)
	h.mux.HandleFunc("GET /api/activity/{id}", h.activityOne)
	h.mux.HandleFunc("GET /api/usage", h.usage)
	h.mux.HandleFunc("GET /api/settings", h.settings)
	h.mux.HandleFunc("GET /api/desktop", h.desktop)
	h.mux.HandleFunc("PUT /api/desktop", h.saveDesktop)
	h.mux.HandleFunc("GET /api/fallbacks", h.fallbacks)
	h.mux.HandleFunc("POST /api/fallbacks", h.saveFallback)
	h.mux.HandleFunc("DELETE /api/fallbacks/{id}", h.deleteFallback)
	h.mux.HandleFunc("GET /api/cache", h.cache)
	h.mux.HandleFunc("PUT /api/cache", h.saveCache)
	h.mux.HandleFunc("POST /api/safety/check", h.safety)
	h.mux.HandleFunc("GET /api/boards/{kind}", h.boardList)
	h.mux.HandleFunc("POST /api/boards/{kind}", h.boardSave)
	h.mux.HandleFunc("PUT /api/boards/{kind}/{id}", h.boardSave)
	h.mux.HandleFunc("DELETE /api/boards/{kind}/{id}", h.boardDelete)
	h.mux.HandleFunc("POST /api/playground/chat", h.playChat)
	h.mux.HandleFunc("POST /api/playground/media", h.playMedia)
	h.mux.HandleFunc("POST /api/playground/decision", h.playDecision)
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !isPublic(r) && !h.authorized(r) {
		writeErr(w, http.StatusUnauthorized, "Sign in with the admin token from the data folder.")
		return
	}
	h.mux.ServeHTTP(w, r)
}

func isPublic(r *http.Request) bool {
	return r.Method == http.MethodPost && r.URL.Path == "/api/login"
}

func (h *Handler) authorized(r *http.Request) bool {
	if h.Store == nil {
		return false
	}
	if c, err := r.Cookie("wowrouter_session"); err == nil && h.Store.SessionOK(c.Value) {
		return true
	}
	token := bearer(r)
	return h.Store.BootstrapMatches(token) || h.Store.SessionOK(token)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil || !h.Store.BootstrapMatches(strings.TrimSpace(body.Token)) {
		writeErr(w, http.StatusUnauthorized, "That admin token was not recognized.")
		return
	}
	raw, err := h.Store.CreateSession()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "wowrouter_session", Value: raw, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("wowrouter_session"); err == nil {
		h.Store.DeleteSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "wowrouter_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) session(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) overview(w http.ResponseWriter, _ *http.Request) {
	providers := 0
	for _, item := range h.providerViews() {
		if item.Enabled {
			providers++
		}
	}
	active := 0
	for _, item := range h.modelViews("") {
		if item.Active {
			active++
		}
	}
	keys, _ := h.Store.List("keys")
	writeJSON(w, http.StatusOK, map[string]any{
		"providers": providers, "activeModels": active, "routerKeys": len(keys),
		"endpoint": "http://" + h.Addr + "/v1",
	})
}

type providerView struct {
	Slug            string `json:"slug"`
	DisplayName     string `json:"displayName"`
	Protocol        string `json:"protocol"`
	BaseURL         string `json:"baseUrl"`
	DocsURL         string `json:"docsUrl"`
	Summary         string `json:"summary"`
	Category        string `json:"category"`
	Free            bool   `json:"free"`
	KeyOptional     bool   `json:"keyOptional"`
	HasAPIKey       bool   `json:"hasApiKey"`
	APIKeyHint      string `json:"apiKeyHint"`
	Enabled         bool   `json:"enabled"`
	AccountStrategy string `json:"accountStrategy"`
	AccountCount    int    `json:"accountCount"`
	ActiveModels    int    `json:"activeModels"`
	TotalModels     int    `json:"totalModels"`
	UpdatedAt       string `json:"updatedAt"`
}

func (h *Handler) providers(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	category := r.URL.Query().Get("category")
	all := h.providerViews()
	counts := map[string]providerCount{}
	for _, item := range all {
		c := counts[item.Category]
		c.Total++
		if item.Enabled {
			c.Ready++
		}
		counts[item.Category] = c
	}
	filtered := make([]providerView, 0, len(all))
	for _, item := range all {
		if category != "" && category != "all" && item.Category != category {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(item.DisplayName+" "+item.Slug+" "+item.Summary), q) {
			continue
		}
		filtered = append(filtered, item)
	}
	limit, offset := pageQuery(r, 18)
	page := filtered
	if offset < len(page) {
		page = page[offset:]
	} else {
		page = []providerView{}
	}
	if limit < len(page) {
		page = page[:limit]
	}
	cats := make([]map[string]any, 0, len(counts))
	names := make([]string, 0, len(counts))
	for name := range counts {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		c := counts[name]
		cats = append(cats, map[string]any{"id": name, "label": name, "total": c.Total, "ready": c.Ready})
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": page, "categories": cats, "total": len(filtered), "limit": limit, "offset": offset})
}

type providerCount struct{ Total, Ready int }

func (h *Handler) provider(w http.ResponseWriter, r *http.Request) {
	view, ok := h.oneProvider(r.PathValue("slug"))
	if !ok {
		writeErr(w, http.StatusNotFound, "No such provider.")
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (h *Handler) saveProvider(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var body struct {
		APIKey          string `json:"apiKey"`
		BaseURL         string `json:"baseUrl"`
		Enabled         *bool  `json:"enabled"`
		AccountStrategy string `json:"accountStrategy"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	spec := h.providerSpec(slug)
	if body.BaseURL != "" {
		spec["base_url"] = strings.TrimSpace(body.BaseURL)
	}
	if body.Enabled != nil {
		spec["enabled"] = *body.Enabled
	}
	if body.AccountStrategy != "" {
		spec["account_strategy"] = body.AccountStrategy
	}
	if strings.TrimSpace(body.APIKey) != "" {
		spec["auth"] = map[string]any{"api_key": strings.TrimSpace(body.APIKey)}
	}
	if _, err := h.Store.Put("providers", slug, spec, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	view, _ := h.oneProvider(slug)
	writeJSON(w, http.StatusOK, view)
}

func (h *Handler) providerSpec(slug string) map[string]any {
	if res, err := h.Store.Get("providers", slug); err == nil && res.Private != nil {
		return cloneMap(res.Private)
	}
	spec := map[string]any{"type": "openai", "enabled": false, "display_name": slug}
	if known, ok := directoryBySlug(slug); ok {
		spec["type"] = known.Protocol
		spec["display_name"] = known.Display
		spec["base_url"] = known.BaseURL
		spec["summary"] = known.Summary
		spec["category"] = known.Category
		spec["docs_url"] = known.Docs
	}
	return spec
}

func (h *Handler) providerViews() []providerView {
	saved := map[string]admin.Resource{}
	if h.Store != nil {
		list, _ := h.Store.List("providers")
		for _, item := range list {
			saved[item.Name] = item
		}
	}
	seen := map[string]bool{}
	var out []providerView
	for _, known := range knownProviders {
		out = append(out, h.viewOf(known.Slug, saved[known.Slug], true))
		seen[known.Slug] = true
	}
	names := make([]string, 0, len(saved))
	for name := range saved {
		if !seen[name] {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		out = append(out, h.viewOf(name, saved[name], false))
	}
	return out
}

func (h *Handler) oneProvider(slug string) (providerView, bool) {
	for _, item := range h.providerViews() {
		if item.Slug == slug {
			return item, true
		}
	}
	return providerView{}, false
}

func (h *Handler) viewOf(slug string, res admin.Resource, known bool) providerView {
	spec := res.Private
	if spec == nil {
		spec = res.Spec
	}
	view := providerView{Slug: slug, DisplayName: slug, Protocol: "openai", Category: "Custom"}
	if entry, ok := directoryBySlug(slug); ok {
		view.DisplayName = entry.Display
		view.Protocol = entry.Protocol
		view.BaseURL = entry.BaseURL
		view.DocsURL = entry.Docs
		view.Summary = entry.Summary
		view.Category = entry.Category
		view.Free = entry.Free
		view.KeyOptional = entry.KeyOptional
	} else if !known && spec == nil {
		return view
	}
	if spec != nil {
		if v := asString(spec["display_name"]); v != "" {
			view.DisplayName = v
		}
		if v := asString(spec["type"]); v != "" {
			view.Protocol = v
		}
		if v := asString(spec["base_url"]); v != "" {
			view.BaseURL = v
		}
		if v := asString(spec["summary"]); v != "" {
			view.Summary = v
		}
		if v := asString(spec["category"]); v != "" {
			view.Category = v
		}
		if v := asString(spec["docs_url"]); v != "" {
			view.DocsURL = v
		}
		view.Enabled = spec["enabled"] == true
		view.AccountStrategy = asString(spec["account_strategy"])
		view.UpdatedAt = res.UpdatedAt
		key := asString(asMap(spec["auth"])["api_key"])
		view.HasAPIKey = key != "" && key != "[REDACTED]"
		if view.HasAPIKey && len(key) >= 4 {
			view.APIKeyHint = key[len(key)-4:]
		}
		if accounts := asSlice(spec["accounts"]); len(accounts) > 0 {
			view.AccountCount = len(accounts)
			if !view.HasAPIKey {
				view.HasAPIKey = true
			}
		}
	}
	models := h.modelViews(slug)
	view.TotalModels = len(models)
	for _, model := range models {
		if model.Active {
			view.ActiveModels++
		}
	}
	return view
}

type modelView struct {
	ID                  string  `json:"id"`
	ProviderSlug        string  `json:"providerSlug"`
	UpstreamID          string  `json:"upstreamId"`
	DisplayName         string  `json:"displayName"`
	Description         string  `json:"description"`
	ContextWindow       int     `json:"contextWindow"`
	MaxOutputTokens     int     `json:"maxOutputTokens"`
	InputUsdPerMillion  float64 `json:"inputUsdPerMillion"`
	OutputUsdPerMillion float64 `json:"outputUsdPerMillion"`
	KnowledgeCutoff     string  `json:"knowledgeCutoff"`
	Reasoning           bool    `json:"reasoning"`
	Kind                string  `json:"kind"`
	Inputs              string  `json:"inputs"`
	Outputs             string  `json:"outputs"`
	Active              bool    `json:"active"`
}

func (h *Handler) modelViews(provider string) []modelView {
	if h.Store == nil {
		return nil
	}
	list, _ := h.Store.List("deployments")
	var out []modelView
	for _, item := range list {
		spec := item.Spec
		slug := asString(spec["provider"])
		if provider != "" && slug != provider {
			continue
		}
		upstream := asString(spec["model"])
		if slug == "" || upstream == "" {
			continue
		}
		price := asMap(spec["price"])
		out = append(out, modelView{
			ID: slug + "/" + upstream, ProviderSlug: slug, UpstreamID: upstream,
			DisplayName: upstream, Kind: "chat", Active: spec["enabled"] != false,
			InputUsdPerMillion: asFloat(price["input"]), OutputUsdPerMillion: asFloat(price["output"]),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (h *Handler) providerModels(w http.ResponseWriter, r *http.Request) {
	models := h.modelViews(r.PathValue("slug"))
	q := strings.ToLower(r.URL.Query().Get("q"))
	if q != "" {
		filtered := models[:0:0]
		for _, item := range models {
			if strings.Contains(strings.ToLower(item.ID+" "+item.DisplayName), q) {
				filtered = append(filtered, item)
			}
		}
		models = filtered
	}
	limit, offset := pageQuery(r, 50)
	total := len(models)
	if offset < len(models) {
		models = models[offset:]
	} else {
		models = []modelView{}
	}
	if limit < len(models) {
		models = models[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models, "total": total, "limit": limit, "offset": offset})
}

func (h *Handler) activeModels(w http.ResponseWriter, _ *http.Request) {
	models := h.modelViews("")
	active := make([]modelView, 0, len(models))
	for _, item := range models {
		if item.Active {
			active = append(active, item)
		}
	}
	if h.Store != nil {
		list, _ := h.Store.List("models")
		for _, item := range list {
			if item.Spec["enabled"] == false {
				continue
			}
			name := asString(item.Spec["display_name"])
			if name == "" {
				name = item.Name
			}
			active = append(active, modelView{
				ID: item.Name, ProviderSlug: "wowrouter", UpstreamID: item.Name,
				DisplayName: name, Kind: "chat", Active: true,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": active})
}

func (h *Handler) setModel(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	upstream := strings.Trim(r.PathValue("upstream"), "/")
	var body struct {
		Active *bool `json:"active"`
	}
	if err := readJSON(r, &body); err != nil || body.Active == nil {
		writeErr(w, http.StatusBadRequest, "Say whether the model is active.")
		return
	}
	name := deploymentName(slug, upstream)
	spec := map[string]any{"provider": slug, "model": upstream, "enabled": *body.Active}
	if prev, err := h.Store.Get("deployments", name); err == nil {
		spec = cloneMap(prev.Private)
		if spec == nil {
			spec = cloneMap(prev.Spec)
		}
		spec["enabled"] = *body.Active
		spec["provider"] = slug
		spec["model"] = upstream
	}
	if _, err := h.Store.Put("deployments", name, spec, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, item := range h.modelViews(slug) {
		if item.UpstreamID == upstream {
			writeJSON(w, http.StatusOK, item)
			return
		}
	}
	writeErr(w, http.StatusNotFound, "No such model.")
}

func (h *Handler) testProvider(w http.ResponseWriter, r *http.Request) {
	n, err := h.fetchUpstreamModels(r.PathValue("slug"), r)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "upstreamModels": n})
}

func (h *Handler) loadModels(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	ids, err := h.upstreamIDs(slug, r)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	for _, id := range ids {
		name := deploymentName(slug, id)
		if _, err := h.Store.Get("deployments", name); err == nil {
			continue
		}
		if _, err := h.Store.Put("deployments", name, map[string]any{"provider": slug, "model": id, "enabled": false}, "", false); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": len(ids)})
}

func (h *Handler) fetchUpstreamModels(slug string, r *http.Request) (int, error) {
	ids, err := h.upstreamIDs(slug, r)
	return len(ids), err
}

func (h *Handler) upstreamIDs(slug string, r *http.Request) ([]string, error) {
	var body struct {
		APIKey  string `json:"apiKey"`
		BaseURL string `json:"baseUrl"`
	}
	_ = readJSON(r, &body)
	spec := h.providerSpec(slug)
	base := strings.TrimSpace(body.BaseURL)
	if base == "" {
		base = asString(spec["base_url"])
	}
	key := strings.TrimSpace(body.APIKey)
	if key == "" {
		key = asString(asMap(spec["auth"])["api_key"])
	}
	if base == "" {
		return nil, errString("Set a base URL first.")
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(base, "/")+"/models", nil)
	if err != nil {
		return nil, err
	}
	if key != "" && key != "[REDACTED]" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 300 {
		return nil, errString("Upstream returned " + resp.Status)
	}
	var listed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &listed) != nil {
		return nil, errString("Upstream did not return a model list.")
	}
	ids := make([]string, 0, len(listed.Data))
	for _, item := range listed.Data {
		if item.ID != "" {
			ids = append(ids, item.ID)
		}
	}
	return ids, nil
}

type accountView struct {
	ID           string `json:"id"`
	ProviderSlug string `json:"providerSlug"`
	Name         string `json:"name"`
	HasAPIKey    bool   `json:"hasApiKey"`
	APIKeyHint   string `json:"apiKeyHint"`
	Priority     int    `json:"priority"`
	Enabled      bool   `json:"enabled"`
	LastUsedAt   any    `json:"lastUsedAt"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

func (h *Handler) accounts(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"accounts": h.accountViews(r.PathValue("slug"))})
}

func (h *Handler) accountViews(slug string) []accountView {
	spec := h.providerSpec(slug)
	var out []accountView
	for _, item := range asSlice(spec["accounts"]) {
		acc := asMap(item)
		key := asString(acc["api_key"])
		hint := ""
		if len(key) >= 4 {
			hint = key[len(key)-4:]
		}
		out = append(out, accountView{
			ID: asString(acc["id"]), ProviderSlug: slug, Name: asString(acc["name"]),
			HasAPIKey: key != "", APIKeyHint: hint, Priority: int(asFloat(acc["priority"])),
			Enabled: acc["enabled"] != false, CreatedAt: asString(acc["created_at"]), UpdatedAt: asString(acc["updated_at"]),
		})
	}
	return out
}

func (h *Handler) createAccount(w http.ResponseWriter, r *http.Request) {
	h.writeAccount(w, r, "")
}

func (h *Handler) saveAccount(w http.ResponseWriter, r *http.Request) {
	h.writeAccount(w, r, r.PathValue("id"))
}

func (h *Handler) writeAccount(w http.ResponseWriter, r *http.Request, id string) {
	slug := r.PathValue("slug")
	var body struct {
		Name     string `json:"name"`
		APIKey   string `json:"apiKey"`
		Priority *int   `json:"priority"`
		Enabled  *bool  `json:"enabled"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	spec := h.providerSpec(slug)
	accounts := asSlice(spec["accounts"])
	now := time.Now().UTC().Format(time.RFC3339)
	if id == "" {
		if strings.TrimSpace(body.APIKey) == "" {
			writeErr(w, http.StatusBadRequest, "An account needs an API key.")
			return
		}
		id = "acct-" + shortHash(slug+body.APIKey+now)
		priority := len(accounts) + 1
		if body.Priority != nil {
			priority = *body.Priority
		}
		enabled := true
		if body.Enabled != nil {
			enabled = *body.Enabled
		}
		accounts = append(accounts, map[string]any{
			"id": id, "name": fallback(body.Name, "Account"), "api_key": strings.TrimSpace(body.APIKey),
			"priority": priority, "enabled": enabled, "created_at": now, "updated_at": now,
		})
	} else {
		found := false
		for i, item := range accounts {
			acc := asMap(item)
			if asString(acc["id"]) != id {
				continue
			}
			found = true
			if body.Name != "" {
				acc["name"] = body.Name
			}
			if strings.TrimSpace(body.APIKey) != "" {
				acc["api_key"] = strings.TrimSpace(body.APIKey)
			}
			if body.Priority != nil {
				acc["priority"] = *body.Priority
			}
			if body.Enabled != nil {
				acc["enabled"] = *body.Enabled
			}
			acc["updated_at"] = now
			accounts[i] = acc
		}
		if !found {
			writeErr(w, http.StatusNotFound, "No such account.")
			return
		}
	}
	spec["accounts"] = accounts
	if _, err := h.Store.Put("providers", slug, spec, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, item := range h.accountViews(slug) {
		if item.ID == id {
			writeJSON(w, http.StatusOK, item)
			return
		}
	}
	writeErr(w, http.StatusNotFound, "No such account.")
}

func (h *Handler) deleteAccount(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	id := r.PathValue("id")
	spec := h.providerSpec(slug)
	next := []any{}
	for _, item := range asSlice(spec["accounts"]) {
		if asString(asMap(item)["id"]) == id {
			continue
		}
		next = append(next, item)
	}
	spec["accounts"] = next
	if _, err := h.Store.Put("providers", slug, spec, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) keys(w http.ResponseWriter, _ *http.Request) {
	list, err := h.Store.List("keys")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]map[string]any, 0, len(list))
	for _, item := range list {
		items = append(items, keyView(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": items})
}

func (h *Handler) createKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	_ = readJSON(r, &body)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "key"
	}
	id := "key-" + shortHash(name+time.Now().String())
	res, err := h.Store.Put("keys", id, map[string]any{"enabled": true, "description": name, "project": "default"}, "", false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	view := keyView(res)
	view["secret"] = res.Once
	writeJSON(w, http.StatusCreated, view)
}

func (h *Handler) keyLimits(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		MonthlyUSD float64 `json:"monthlyUsd"`
		RPM        int     `json:"rpm"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	res, err := h.Store.Get("keys", id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "No such key.")
		return
	}
	spec := cloneMap(res.Private)
	policies := asMap(spec["policies"])
	if policies == nil {
		policies = map[string]any{}
	}
	if body.MonthlyUSD > 0 {
		policies["budgets"] = map[string]any{"monthly": map[string]any{
			"unit": "usd", "amount": fmt.Sprintf("%g", body.MonthlyUSD), "period": "monthly", "mode": "hard",
		}}
	}
	if body.RPM > 0 {
		policies["limits"] = map[string]any{"rpm": map[string]any{"unit": "requests", "limit": body.RPM, "per": "1m"}}
	}
	spec["policies"] = policies
	if _, err := h.Store.Put("keys", id, spec, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "monthlyUsd": body.MonthlyUSD, "rpm": body.RPM})
}

func (h *Handler) deleteKey(w http.ResponseWriter, r *http.Request) {
	if err := h.Store.Delete("keys", r.PathValue("id"), ""); err != nil {
		writeErr(w, http.StatusNotFound, "No such key.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func keyView(res admin.Resource) map[string]any {
	hint := asString(res.Private["secret_hint"])
	prefix := "sk-wowrouter-"
	if hint != "" {
		prefix = "…" + hint
	}
	return map[string]any{
		"id": res.Name, "name": fallback(asString(res.Spec["description"]), res.Name),
		"prefix": prefix, "createdAt": res.CreatedAt, "lastUsedAt": nil,
	}
}

func (h *Handler) activity(w http.ResponseWriter, _ *http.Request) {
	logs := h.Store.Logs("", "", 200)
	items := make([]map[string]any, 0, len(logs))
	for _, rec := range logs {
		items = append(items, activityView(rec))
	}
	writeJSON(w, http.StatusOK, map[string]any{"activity": items})
}

func (h *Handler) activityOne(w http.ResponseWriter, r *http.Request) {
	rec, ok := h.Store.LogByID(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "No such request.")
		return
	}
	view := activityView(rec)
	raw, _ := json.Marshal(rec)
	view["requestJson"] = string(raw)
	writeJSON(w, http.StatusOK, view)
}

func (h *Handler) clearActivity(w http.ResponseWriter, _ *http.Request) {
	h.Store.ClearLogs()
	w.WriteHeader(http.StatusNoContent)
}

func activityView(rec map[string]any) map[string]any {
	usage := asMap(rec["usage"])
	timing := asMap(rec["timing"])
	return map[string]any{
		"id": asString(rec["id"]), "createdAt": asString(rec["started_at"]), "source": asString(rec["key"]),
		"modelId": asString(rec["model"]), "statusCode": int(asFloat(rec["status_code"])),
		"latencyMs": int(asFloat(timing["total_ms"])), "promptTokens": int(asFloat(usage["input"])),
		"completionTokens": int(asFloat(usage["output"])), "errorMessage": asString(rec["error_message"]),
	}
}

func (h *Handler) usage(w http.ResponseWriter, _ *http.Request) {
	type row struct {
		ModelID          string  `json:"modelId"`
		Requests         int     `json:"requests"`
		Errors           int     `json:"errors"`
		PromptTokens     int     `json:"promptTokens"`
		CompletionTokens int     `json:"completionTokens"`
		CostUSD          float64 `json:"costUsd"`
	}
	by := map[string]*row{}
	for _, rec := range h.Store.Logs("", "", 5000) {
		id := asString(rec["model"])
		if id == "" {
			id = "(none)"
		}
		item := by[id]
		if item == nil {
			item = &row{ModelID: id}
			by[id] = item
		}
		item.Requests++
		if int(asFloat(rec["status_code"])) >= 400 {
			item.Errors++
		}
		usage := asMap(rec["usage"])
		item.PromptTokens += int(asFloat(usage["input"]))
		item.CompletionTokens += int(asFloat(usage["output"]))
	}
	rows := make([]row, 0, len(by))
	totals := row{}
	for _, item := range by {
		rows = append(rows, *item)
		totals.Requests += item.Requests
		totals.Errors += item.Errors
		totals.PromptTokens += item.PromptTokens
		totals.CompletionTokens += item.CompletionTokens
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Requests > rows[j].Requests })
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "totals": totals})
}

func (h *Handler) settings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"dataDir": h.DataDir, "address": h.Addr, "logCount": len(h.Store.Logs("", "", 5000)),
	})
}

func (h *Handler) desktop(w http.ResponseWriter, _ *http.Request) {
	pref := desktoppref.Load(h.DataDir)
	writeJSON(w, http.StatusOK, map[string]any{"os": runtime.GOOS, "startWithWindows": pref.StartWithWindows})
}

func (h *Handler) saveDesktop(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StartWithWindows bool `json:"startWithWindows"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	if err := desktoppref.Save(h.DataDir, desktoppref.Pref{StartWithWindows: body.StartWithWindows}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) fallbacks(w http.ResponseWriter, _ *http.Request) {
	list, _ := h.Store.List("fallbacks")
	items := make([]map[string]any, 0, len(list))
	for _, item := range list {
		items = append(items, fallbackView(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"fallbacks": items})
}

func (h *Handler) saveFallback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name   string   `json:"name"`
		Models []string `json:"models"`
	}
	if err := readJSON(r, &body); err != nil || len(body.Models) == 0 {
		writeErr(w, http.StatusBadRequest, "Name a chain and pick at least one model.")
		return
	}
	id := "fb-" + shortHash(body.Name+strings.Join(body.Models, ","))
	children := []any{}
	for _, model := range body.Models {
		dep := deploymentFromPublic(model)
		if dep == "" {
			continue
		}
		children = append(children, map[string]any{"type": "deployment", "deployment": dep})
	}
	if len(children) == 0 {
		writeErr(w, http.StatusBadRequest, "None of those models is a saved deployment.")
		return
	}
	route := "route-" + id
	if _, err := h.Store.Put("routes", route, map[string]any{
		"enabled": true,
		"tree":    map[string]any{"type": "fallback", "children": children},
	}, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	modelName := "fallback/" + id
	if _, err := h.Store.Put("models", modelName, map[string]any{
		"enabled": true, "route": route, "display_name": fallback(body.Name, id),
	}, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved, err := h.Store.Put("fallbacks", id, map[string]any{
		"name": body.Name, "models": body.Models, "model_id": modelName,
	}, "", false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, fallbackView(saved))
}

func (h *Handler) deleteFallback(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_ = h.Store.Delete("fallbacks", id, "")
	_ = h.Store.Delete("models", "fallback/"+id, "")
	_ = h.Store.Delete("routes", "route-"+id, "")
	w.WriteHeader(http.StatusNoContent)
}

func fallbackView(res admin.Resource) map[string]any {
	models := []string{}
	for _, item := range asSlice(res.Spec["models"]) {
		if s := asString(item); s != "" {
			models = append(models, s)
		}
	}
	return map[string]any{
		"id": res.Name, "name": asString(res.Spec["name"]), "modelId": asString(res.Spec["model_id"]),
		"models": models, "createdAt": res.CreatedAt,
	}
}

func deploymentFromPublic(id string) string {
	provider, upstream, ok := strings.Cut(id, "/")
	if !ok || provider == "" || upstream == "" || strings.Contains(upstream, "/") {
		return ""
	}
	return deploymentName(provider, upstream)
}

func (h *Handler) cache(w http.ResponseWriter, _ *http.Request) {
	enabled := true
	if res, err := h.Store.Get("settings", "cache"); err == nil && res.Spec["enabled"] == false {
		enabled = false
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": enabled})
}

func (h *Handler) saveCache(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	if _, err := h.Store.Put("settings", "cache", map[string]any{"enabled": body.Enabled}, "", false); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": body.Enabled})
}

func (h *Handler) safety(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	rules := h.Store.Resources("guardrails")
	out := gateway.Apply(rules, body.Text, "input")
	writeJSON(w, http.StatusOK, map[string]any{"text": out.Text, "blocked": out.Blocked, "hits": out.Hits})
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func readJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(dest)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(body)
}

func writeErr(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func pageQuery(r *http.Request, def int) (int, int) {
	limit := def
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		var n int
		if _, err := fmtSscan(v, &n); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		var n int
		if _, err := fmtSscan(v, &n); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

func fmtSscan(s string, n *int) (int, error) {
	var err error
	_, err = parseInt(s, n)
	return 1, err
}

func parseInt(s string, n *int) (int, error) {
	v := 0
	if s == "" {
		return 0, errString("empty")
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errString("nan")
		}
		v = v*10 + int(c-'0')
	}
	*n = v
	return v, nil
}

type errString string

func (e errString) Error() string { return string(e) }

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	default:
		return ""
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	raw, _ := json.Marshal(in)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func fallback(v, other string) string {
	if strings.TrimSpace(v) == "" {
		return other
	}
	return v
}

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:4])
}

func deploymentName(slug, upstream string) string {
	raw := slug + "-" + upstream
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	name := b.String()
	if len(name) > 120 {
		name = name[:80] + "-" + shortHash(raw)
	}
	return name
}
