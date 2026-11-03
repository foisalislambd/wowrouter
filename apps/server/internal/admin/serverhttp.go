package admin

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/oauth"
)

func (a *API) oauthCatalog(w http.ResponseWriter, _ *http.Request) {
	var items []any
	for _, p := range oauth.Catalog() {
		items = append(items, map[string]any{
			"id": p.ID, "flow": p.Flow, "configured": p.ClientID != "" || p.Flow == "cursor" || p.Flow == "device" && p.ID == "kiro",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": items})
}

func (a *API) users(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		var items []any
		for _, user := range a.Store.Resources("users") {
			items = append(items, map[string]any{"name": user.Name, "email": user.Spec["email"], "role": user.Spec["role"], "enabled": user.Spec["enabled"] != false})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return
	}
	var body map[string]any
	if err := readBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := a.Store.UpsertUser(asString(body["email"]), asString(body["password"]), asString(body["role"])); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	a.Store.AddAudit(map[string]any{"action": "create", "resource": "users", "detail": asString(body["email"])})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) evals(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"items": a.Store.Evals()})
		return
	}
	var body map[string]any
	if err := readBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	name := asString(body["name"])
	if name == "" {
		name = "eval"
	}
	model := asString(body["model"])
	var results []any
	passed := 0
	for _, item := range asSlice(body["cases"]) {
		row := asMap(item)
		prompt := asString(row["prompt"])
		expect := asString(row["contains"])
		useModel := asString(row["model"])
		if useModel == "" {
			useModel = model
		}
		out := a.Engine.Handle(gateway.Call{Model: useModel, Body: map[string]any{
			"model": useModel, "messages": []any{map[string]any{"role": "user", "content": prompt}},
		}, Dialect: "openai"})
		text := gateway.ResponseText(out.Body)
		ok := out.Status < 400 && (expect == "" || strings.Contains(text, expect))
		if ok {
			passed++
		}
		results = append(results, map[string]any{"prompt": prompt, "ok": ok, "status": out.Status, "text": text, "error": out.Error})
	}
	id, _ := randomToken("eval_", 6)
	record := map[string]any{"id": id, "name": name, "passed": passed, "total": len(results), "results": results}
	_ = a.Store.SaveEval(id, record)
	writeJSON(w, http.StatusOK, record)
}

func (a *API) syncSnapshot(w http.ResponseWriter, r *http.Request) {
	if !syncAuthorized(r, a) {
		writeErr(w, http.StatusUnauthorized, "unauthenticated", "A sync token is required.")
		return
	}
	if r.Method == http.MethodGet {
		gen, items, err := a.Store.Snapshot()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"generation": gen, "items": items})
		return
	}
	var body map[string]any
	if err := readBody(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := a.Store.ApplySnapshot(int64(asFloat(body["generation"])), asSliceMap(body["items"])); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "generation": a.Store.Generation()})
}

func syncAuthorized(r *http.Request, a *API) bool {
	want := os.Getenv("WOWROUTER_SYNC_TOKEN")
	got := bearer(r)
	if want != "" && subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1 {
		return true
	}
	return a.Authorized(r) && r.Method == http.MethodGet
}

func asSliceMap(v any) []map[string]any {
	var out []map[string]any
	for _, item := range asSlice(v) {
		if row := asMap(item); row != nil {
			out = append(out, row)
		}
	}
	return out
}

// PullSnapshot copies a newer peer snapshot. The peer must share secret.key.
func PullSnapshot(store *Store, peer, token string, client *http.Client) error {
	if peer == "" || store == nil {
		return nil
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(peer, "/")+"/admin/v1/sync/snapshot", nil)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var body struct {
		Generation int64            `json:"generation"`
		Items      []map[string]any `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	return store.ApplySnapshot(body.Generation, body.Items)
}
