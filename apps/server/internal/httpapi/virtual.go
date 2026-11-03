package httpapi

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"wowrouter/server/internal/gateway"
)

func str(v any) string {
	s, _ := v.(string)
	return s
}

func (s *Server) gatewayAnthropic(w http.ResponseWriter, r *http.Request) {
	s.dialect(w, r, "anthropic", "")
}

func (s *Server) gatewayGemini(w http.ResponseWriter, r *http.Request) {
	model := r.PathValue("model")
	model = strings.TrimSuffix(model, ":streamGenerateContent")
	model = strings.TrimSuffix(model, ":generateContent")
	s.dialect(w, r, "gemini", model)
}

func (s *Server) gatewayBedrock(w http.ResponseWriter, r *http.Request) {
	s.dialect(w, r, "bedrock", r.PathValue("model"))
}

func (s *Server) dialect(w http.ResponseWriter, r *http.Request, kind, model string) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 20<<20))
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	body, err := gateway.ToOpenAI(kind, model, raw)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, err.Error(), "invalid_request_error", "invalid_body")
		return
	}
	encoded, _ := json.Marshal(body)
	model = str(body["model"])
	s.dispatch(w, keyID, encoded, kind, model)
}

func (s *Server) gatewayMCP(w http.ResponseWriter, r *http.Request) {
	if s.Admin == nil {
		http.NotFound(w, r)
		return
	}
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	name := r.PathValue("name")
	res, err := s.Admin.Store.Get("mcp/servers", name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no such MCP server"})
		return
	}
	target := str(res.Spec["url"])
	if target == "" {
		writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "result": map[string]any{"name": name, "configured": true}})
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	s.proxyJSON(w, r, target, raw)
}

func (s *Server) gatewayA2A(w http.ResponseWriter, r *http.Request) {
	if s.Admin == nil {
		http.NotFound(w, r)
		return
	}
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	name := r.PathValue("name")
	res, err := s.Admin.Store.Get("a2a/agents", name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no such agent"})
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	target := str(res.Spec["url"])
	if target == "" {
		writeJSON(w, http.StatusOK, map[string]any{"agent": name, "status": "configured", "echo": json.RawMessage(raw)})
		return
	}
	s.proxyJSON(w, r, target, raw)
}

func (s *Server) proxyJSON(w http.ResponseWriter, r *http.Request, target string, raw []byte) {
	if err := gateway.SafeHTTPURL(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(raw))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("stopped after 3 redirects")
		}
		return gateway.SafeHTTPURL(req.URL.String())
	}}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 8<<20))
}

func (s *Server) scim(w http.ResponseWriter, r *http.Request) {
	if s.Admin == nil {
		http.NotFound(w, r)
		return
	}
	token := bearerToken(r)
	settings, err := s.Admin.Store.Get("settings", "auth")
	want := ""
	if err == nil {
		want = str(settings.Private["scim_token"])
		if want == "" {
			want = str(asMap(settings.Private["scim"])["bearer_token"])
		}
	}
	if want == "" || !secretEqual(token, want) {
		w.Header().Set("Content-Type", "application/scim+json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":"SCIM token required"}`))
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/scim/v2"), "/")
	if path == "Users" && r.Method == http.MethodGet {
		users := s.Admin.Store.Resources("users")
		resources := []any{}
		for _, user := range users {
			resources = append(resources, scimUser(user.Name, user.Spec))
		}
		writeJSON(w, http.StatusOK, map[string]any{"schemas": []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"}, "totalResults": len(resources), "Resources": resources})
		return
	}
	if path == "Users" && r.Method == http.MethodPost {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		name := str(body["userName"])
		if name == "" {
			name = str(body["externalId"])
		}
		spec := map[string]any{"email": str(body["userName"]), "display_name": str(body["displayName"]), "enabled": body["active"] != false, "kind": "human"}
		if _, err := s.Admin.Store.Put("users", name, spec, "", false); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, scimUser(name, spec))
		return
	}
	if strings.HasPrefix(path, "Users/") && r.Method == http.MethodDelete {
		name := strings.TrimPrefix(path, "Users/")
		_ = s.Admin.Store.Delete("users", name, "")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"detail": "unsupported SCIM path"})
}

func secretEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func scimUser(name string, spec map[string]any) map[string]any {
	return map[string]any{
		"schemas": []string{"urn:ietf:params:scim:schemas:core:2.0:User"},
		"id":      name, "userName": str(spec["email"]), "displayName": str(spec["display_name"]), "active": spec["enabled"] != false,
	}
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}
