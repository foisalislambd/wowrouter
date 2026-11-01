package panelapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/gateway"
)

func boardCollection(kind string) (string, bool) {
	switch kind {
	case "models", "routes", "guardrails", "alerts", "channels", "mcp", "agents", "plugins", "teams", "orgs", "projects", "changes":
		return map[string]string{
			"models": "models", "routes": "routes", "guardrails": "guardrails",
			"alerts": "alerts/rules", "channels": "alerts/channels", "mcp": "mcp/servers",
			"agents": "a2a/agents", "plugins": "plugins", "teams": "teams",
			"orgs": "organizations", "projects": "projects", "changes": "change_requests",
		}[kind], true
	default:
		return "", false
	}
}

type boardItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Detail  string `json:"detail"`
	Enabled bool   `json:"enabled"`
	Body    string `json:"body"`
}

func (h *Handler) boardList(w http.ResponseWriter, r *http.Request) {
	col, ok := boardCollection(r.PathValue("kind"))
	if !ok {
		writeErr(w, http.StatusNotFound, "No such section.")
		return
	}
	list, err := h.Store.List(col)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	items := make([]boardItem, 0, len(list))
	for _, res := range list {
		items = append(items, toBoard(res))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) boardSave(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	col, ok := boardCollection(kind)
	if !ok {
		writeErr(w, http.StatusNotFound, "No such section.")
		return
	}
	var item boardItem
	if err := readJSON(r, &item); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	if r.PathValue("id") != "" {
		item.ID = r.PathValue("id")
	}
	item.ID = strings.TrimSpace(item.ID)
	if item.ID == "" {
		item.ID = kind + "-" + shortHash(item.Title+time.Now().String())
	}
	spec := map[string]any{"enabled": item.Enabled, "display_name": item.Title, "description": item.Detail}
	if item.Body != "" {
		var extra map[string]any
		if json.Unmarshal([]byte(item.Body), &extra) == nil {
			for k, v := range extra {
				spec[k] = v
			}
		} else {
			spec["note"] = item.Body
		}
	}
	if kind == "models" || kind == "routes" {
		if tree := treeFromPlan(spec); tree != nil {
			spec["tree"] = tree
			if kind == "models" && asString(spec["route"]) == "" {
				spec["target"] = tree
			}
		}
	}
	if kind == "guardrails" && asString(spec["type"]) == "" {
		spec["type"] = "keywords"
	}
	if kind == "guardrails" && asString(spec["action"]) == "" {
		spec["action"] = "flag"
	}
	saved, err := h.Store.Put(col, item.ID, spec, "", false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toBoard(saved))
}

func (h *Handler) boardDelete(w http.ResponseWriter, r *http.Request) {
	col, ok := boardCollection(r.PathValue("kind"))
	if !ok {
		writeErr(w, http.StatusNotFound, "No such section.")
		return
	}
	if err := h.Store.Delete(col, r.PathValue("id"), ""); err != nil {
		writeErr(w, http.StatusNotFound, "No such record.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func toBoard(res admin.Resource) boardItem {
	spec := cloneMap(res.Spec)
	title := asString(spec["display_name"])
	if title == "" {
		title = asString(spec["name"])
	}
	if title == "" {
		title = res.Name
	}
	detail := asString(spec["description"])
	delete(spec, "display_name")
	delete(spec, "description")
	raw, _ := json.Marshal(spec)
	return boardItem{ID: res.Name, Title: title, Detail: detail, Enabled: spec["enabled"] != false, Body: string(raw)}
}

func treeFromPlan(spec map[string]any) map[string]any {
	if tree := asMap(spec["tree"]); tree != nil && asString(tree["type"]) != "" {
		return tree
	}
	mode := asString(spec["mode"])
	if mode == "" {
		return nil
	}
	var children []any
	for _, step := range asSlice(spec["steps"]) {
		switch t := step.(type) {
		case string:
			children = append(children, map[string]any{"type": "deployment", "deployment": t})
		default:
			m := asMap(step)
			name := asString(m["deployment"])
			if name == "" {
				continue
			}
			node := map[string]any{"type": "deployment", "deployment": name}
			if asFloat(m["weight"]) > 0 {
				node["weight"] = asFloat(m["weight"])
			}
			children = append(children, node)
		}
	}
	kind := "fallback"
	switch mode {
	case "cheapest":
		kind = "least_cost"
	case "fastest":
		kind = "least_latency"
	case "busy":
		kind = "least_busy"
	case "split":
		kind = "weighted"
	case "block":
		return map[string]any{"type": "block"}
	}
	return map[string]any{"type": kind, "children": children}
}

func (h *Handler) playChat(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	body["stream"] = true
	call := gateway.Call{Model: asString(body["model"]), Body: body, KeyName: "playground", Dialect: "openai"}
	out := h.engine().Handle(call)
	if out.Status >= 400 && out.Stream == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(out.Status)
		if len(out.Body) == 0 {
			_ = json.NewEncoder(w).Encode(map[string]any{"error": out.Error})
			return
		}
		_, _ = w.Write(out.Body)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	req, _ := json.Marshal(body)
	_, _ = w.Write([]byte("event: request\ndata: " + string(req) + "\n\n"))
	if flusher != nil {
		flusher.Flush()
	}
	if out.Stream != nil {
		defer out.Stream.Close()
		buf := make([]byte, 32*1024)
		seen := false
		for {
			n, err := out.Stream.Read(buf)
			if n > 0 {
				if strings.Contains(string(buf[:n]), "[DONE]") {
					seen = true
				}
				_, _ = w.Write(buf[:n])
				if flusher != nil {
					flusher.Flush()
				}
			}
			if err != nil {
				break
			}
		}
		if !seen {
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
		}
		if out.SkipLog {
			h.engine().Record(call, out)
		}
		return
	}
	payload := out.Body
	if !strings.HasPrefix(strings.TrimSpace(string(payload)), "data:") {
		payload = gateway.CompletionToSSE(call.Model, payload)
	}
	_, _ = w.Write(payload)
	if flusher != nil {
		flusher.Flush()
	}
}

func (h *Handler) playMedia(w http.ResponseWriter, r *http.Request) {
	h.playJSON(w, r)
}

func (h *Handler) playDecision(w http.ResponseWriter, r *http.Request) {
	h.playJSON(w, r)
}

func (h *Handler) playJSON(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "The body must be JSON.")
		return
	}
	call := gateway.Call{Model: asString(body["model"]), Body: body, KeyName: "playground", Dialect: "openai"}
	out := h.engine().Handle(call)
	var decoded any
	_ = json.Unmarshal(out.Body, &decoded)
	status := http.StatusOK
	if out.Status >= 400 {
		status = out.Status
	}
	writeJSON(w, status, map[string]any{"request": body, "response": decoded, "error": out.Error})
}

func (h *Handler) engine() *gateway.Engine {
	return gateway.New(h.Store)
}
