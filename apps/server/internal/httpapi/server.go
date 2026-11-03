// Modified by WowRouter.
// Derived from Antirion (https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, Apache-2.0.
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/metrics"
	"wowrouter/server/internal/panelapi"
)

type Server struct {
	ConsoleDir string
	Addr       string
	DataDir    string
	Stop       func()
	Admin      *admin.API
}

func New(addr, dataDir string) *Server {
	return &Server{Addr: addr, DataDir: dataDir}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /ready", s.ready)
	mux.HandleFunc("GET /metrics", s.metrics)
	mux.HandleFunc("POST /api/shutdown", s.shutdown)
	mux.HandleFunc("GET /v1/models", s.gatewayModels)
	mux.HandleFunc("POST /v1/chat/completions", s.gatewayChat)
	mux.HandleFunc("POST /v1/responses", s.gatewayResponses)
	mux.HandleFunc("POST /v1/embeddings", s.gatewayEmbeddings)
	mux.HandleFunc("POST /v1/audio/speech", s.gatewayAudio)
	mux.HandleFunc("POST /v1/audio/transcriptions", s.gatewayAudio)
	mux.HandleFunc("POST /v1/audio/translations", s.gatewayAudio)
	mux.HandleFunc("POST /v1/moderations", s.gatewayModerations)
	mux.HandleFunc("POST /v1/search", s.gatewaySearch)
	mux.HandleFunc("POST /v1/batches", s.gatewayBatches)
	mux.HandleFunc("GET /v1/batches", s.gatewayBatches)
	mux.HandleFunc("GET /v1/batches/{id}", s.gatewayBatches)
	mux.HandleFunc("POST /oauth/{provider}/start", s.oauthStart)
	mux.HandleFunc("POST /oauth/{provider}/device", s.oauthDevice)
	mux.HandleFunc("POST /oauth/{provider}/poll", s.oauthPoll)
	mux.HandleFunc("GET /oauth/{provider}/callback", s.oauthCallback)
	mux.HandleFunc("POST /v1/skills/{name}", s.skill)
	mux.HandleFunc("POST /v1/a2a", s.a2a)
	mux.HandleFunc("POST /v1/messages", s.gatewayAnthropic)
	mux.HandleFunc("POST /v1beta/models/{model...}", s.gatewayGemini)
	mux.HandleFunc("POST /model/{model}/converse", s.gatewayBedrock)
	mux.HandleFunc("POST /mcp/{name}", s.gatewayMCP)
	mux.HandleFunc("POST /a2a/{name}", s.gatewayA2A)
	mux.HandleFunc("POST /v1/systemone", s.gatewayDecision)
	mux.HandleFunc("POST /v1/images/generations", s.gatewayImages)
	mux.HandleFunc("POST /v1/videos/generations", s.gatewayVideos)
	mux.HandleFunc("POST /v1/mcp", s.mcp)
	mux.HandleFunc("GET /v1/bridge", s.bridge)
	mux.HandleFunc("GET /.well-known/agent.json", s.agentCard)
	if s.Admin != nil {
		mux.Handle("/admin/v1/", s.Admin)
		mux.Handle("/admin/v1", s.Admin)
		mux.Handle("/api/", panelapi.New(s.Admin.Store, s.DataDir, s.Addr))
		mux.HandleFunc("/scim/v2/", s.scim)
		mux.HandleFunc("/scim/v2", s.scim)
	}
	mux.Handle("/", s.panel())
	return mux
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "wowrouter"})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	if s.Admin == nil || s.Admin.Store == nil || s.Admin.Store.Ping() != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "service": "wowrouter"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "wowrouter"})
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	metrics.Handler(w, r)
}

func (s *Server) shutdown(w http.ResponseWriter, r *http.Request) {
	if s.Stop == nil {
		writeAPIError(w, http.StatusInternalServerError, "shutdown is not available")
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !ip.IsLoopback() {
		if s.Admin == nil || !s.Admin.Authorized(r) {
			writeAPIError(w, http.StatusUnauthorized, "Sign in to shut the server down.")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	go s.Stop()
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.allowIP(r) {
		writeOpenAIError(w, http.StatusForbidden, "This address is not allowed.", "permission_error", "ip_forbidden")
		return "", false
	}
	token := bearerToken(r)
	if token == "" {
		writeOpenAIError(w, http.StatusUnauthorized, "Missing API key. Create one in the WowRouter console and send it as a Bearer token.", "authentication_error", "invalid_api_key")
		return "", false
	}
	if s.Admin == nil {
		writeOpenAIError(w, http.StatusUnauthorized, "Incorrect API key.", "authentication_error", "invalid_api_key")
		return "", false
	}
	key, ok := s.Admin.Store.AuthenticateKey(token)
	if !ok {
		s.Admin.Store.AddAudit(map[string]any{"action": "deny", "resource": "keys", "detail": "rejected api key"})
		writeOpenAIError(w, http.StatusUnauthorized, "Incorrect API key.", "authentication_error", "invalid_api_key")
		return "", false
	}
	role := str(key.Spec["role"])
	if role == "" {
		role = str(key.Private["role"])
	}
	if role == "viewer" && r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeOpenAIError(w, http.StatusForbidden, "This key is read-only.", "permission_error", "insufficient_role")
		return "", false
	}
	rpm := int(num(key.Spec["rpm"]))
	if rpm <= 0 {
		rpm = int(num(key.Private["rpm"]))
	}
	if rpm > 0 && !s.Admin.Store.AllowRate("key/"+key.Name, rpm, time.Minute) {
		writeOpenAIError(w, http.StatusTooManyRequests, "This key is over its request limit.", "rate_limit_error", "rate_limited")
		return "", false
	}
	quota := num(key.Spec["quota_usd"])
	if quota <= 0 {
		quota = num(key.Private["quota_usd"])
	}
	if quota > 0 && s.Admin.Store.SpendOf("usd/key/"+key.Name) >= quota {
		writeOpenAIError(w, http.StatusTooManyRequests, "This key is over its quota.", "rate_limit_error", "quota")
		return "", false
	}
	return "gw:" + key.Name, true
}

func num(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}

func (s *Server) callFromKey(keyID string, model string, body map[string]any, dialect string) gateway.Call {
	call := gateway.Call{Model: model, Body: body, Dialect: dialect}
	if strings.HasPrefix(keyID, "gw:") {
		name := strings.TrimPrefix(keyID, "gw:")
		call.KeyName = name
		if res, err := s.Admin.Store.Get("keys", name); err == nil {
			call.Project = str(res.Spec["project"])
			if proj, err := s.Admin.Store.Get("projects", call.Project); err == nil {
				call.Team = str(proj.Spec["team"])
				call.Organization = str(proj.Spec["organization"])
			}
			if tags, ok := res.Spec["tags"].([]any); ok {
				for _, tag := range tags {
					call.Tags = append(call.Tags, str(tag))
				}
			}
		}
	}
	return call
}

func (s *Server) writeOutcome(w http.ResponseWriter, call gateway.Call, out gateway.Outcome) {
	if out.Stream != nil {
		defer out.Stream.Close()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(out.Status)
		flusher, _ := w.(http.Flusher)
		if flusher != nil {
			flusher.Flush()
		}
		buf := make([]byte, 32*1024)
		seenDone := false
		for {
			n, err := out.Stream.Read(buf)
			if n > 0 {
				if strings.Contains(string(buf[:n]), "[DONE]") {
					seenDone = true
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
		if !seenDone {
			_, _ = io.WriteString(w, "data: [DONE]\n\n")
			if flusher != nil {
				flusher.Flush()
			}
		}
		if out.SkipLog && s.Admin != nil {
			s.Admin.Engine.Record(call, out)
		}
		return
	}
	body := out.Body
	if out.SSE && out.Status < 400 && !strings.HasPrefix(strings.TrimSpace(string(body)), "data:") {
		body = gateway.CompletionToSSE(call.Model, body)
	}
	if out.SSE && out.Status < 400 {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(out.Status)
		_, _ = w.Write(body)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		return
	}
	if len(body) == 0 {
		body = []byte("{}\n")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(out.Status)
	_, _ = w.Write(body)
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if s.Admin == nil {
		http.NotFound(w, r)
		return false
	}
	return true
}

func modelFromBody(body map[string]any, fallback string) string {
	if m := str(body["model"]); m != "" {
		return m
	}
	return fallback
}

var errNoAdmin = errors.New("gateway is not configured")
