package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"wowrouter/server/internal/gateway"
)

func (s *Server) skill(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	res, err := s.Admin.Store.Get("skills", name)
	if err != nil {
		writeOpenAIError(w, http.StatusNotFound, "No skill with that name.", "invalid_request_error", "not_found")
		return
	}
	var body map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body) != nil {
		writeOpenAIError(w, http.StatusBadRequest, "The request body must be JSON.", "invalid_request_error", "invalid_body")
		return
	}
	model := str(res.Spec["model"])
	if model == "" {
		model = str(body["model"])
	}
	input := str(body["input"])
	template := str(res.Spec["template"])
	if template == "" {
		template = "{{input}}"
	}
	prompt := strings.ReplaceAll(template, "{{input}}", input)
	messages := []any{}
	if system := str(res.Spec["system"]); system != "" {
		messages = append(messages, map[string]any{"role": "system", "content": system})
	}
	messages = append(messages, map[string]any{"role": "user", "content": prompt})
	chat := map[string]any{"model": model, "messages": messages}
	raw, _ := json.Marshal(chat)
	s.dispatch(w, keyID, raw, "openai", model)
}

func (s *Server) a2a(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	var req map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req) != nil {
		writeJSON(w, http.StatusBadRequest, rpcErr(nil, -32700, "invalid json"))
		return
	}
	id := req["id"]
	method := str(req["method"])
	params, _ := req["params"].(map[string]any)
	switch method {
	case "tasks/send", "message/send":
		taskID := str(params["id"])
		if taskID == "" {
			taskID = "task_" + str(id)
		}
		model := str(params["model"])
		if model == "" && s.Admin != nil {
			if settings, err := s.Admin.Store.Get("settings", "a2a"); err == nil {
				model = str(settings.Spec["model"])
			}
		}
		text := a2aText(params)
		if model == "" || text == "" {
			writeJSON(w, http.StatusBadRequest, rpcErr(id, -32602, "model and a text part are required"))
			return
		}
		call := gateway.Call{Model: model, Body: map[string]any{
			"model": model, "messages": []any{map[string]any{"role": "user", "content": text}},
		}, Dialect: "openai"}
		out := s.Admin.Engine.Handle(call)
		state := "completed"
		if out.Status >= 400 {
			state = "failed"
		}
		task := map[string]any{
			"id": taskID, "status": map[string]any{"state": state},
			"artifacts": []any{map[string]any{"parts": []any{map[string]any{"type": "text", "text": gateway.ResponseText(out.Body)}}}},
		}
		_ = s.Admin.Store.SaveTask(taskID, task)
		writeJSON(w, http.StatusOK, rpcOK(id, task))
	case "tasks/get":
		task, ok := s.Admin.Store.Task(str(params["id"]))
		if !ok {
			writeJSON(w, http.StatusOK, rpcErr(id, -32001, "task not found"))
			return
		}
		writeJSON(w, http.StatusOK, rpcOK(id, task))
	case "tasks/cancel":
		task, ok := s.Admin.Store.Task(str(params["id"]))
		if !ok {
			writeJSON(w, http.StatusOK, rpcErr(id, -32001, "task not found"))
			return
		}
		status, _ := task["status"].(map[string]any)
		if status == nil {
			status = map[string]any{}
		}
		status["state"] = "canceled"
		task["status"] = status
		_ = s.Admin.Store.SaveTask(str(params["id"]), task)
		writeJSON(w, http.StatusOK, rpcOK(id, task))
	default:
		writeJSON(w, http.StatusOK, rpcErr(id, -32601, "method not found"))
	}
}

func a2aText(params map[string]any) string {
	msg, _ := params["message"].(map[string]any)
	for _, part := range asSlice(msg["parts"]) {
		row, _ := part.(map[string]any)
		if text := str(row["text"]); text != "" {
			return text
		}
	}
	return str(params["text"])
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}
