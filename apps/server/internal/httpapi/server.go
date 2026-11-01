// Modified by WowRouter.
// Derived from Antirion (https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, Apache-2.0.
package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/gateway"
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
	mux.HandleFunc("POST /api/shutdown", s.shutdown)
	mux.HandleFunc("GET /v1/models", s.gatewayModels)
	mux.HandleFunc("POST /v1/chat/completions", s.gatewayChat)
	mux.HandleFunc("POST /v1/messages", s.gatewayAnthropic)
	mux.HandleFunc("POST /v1beta/models/{model...}", s.gatewayGemini)
	mux.HandleFunc("POST /model/{model}/converse", s.gatewayBedrock)
	mux.HandleFunc("POST /mcp/{name}", s.gatewayMCP)
	mux.HandleFunc("POST /a2a/{name}", s.gatewayA2A)
	mux.HandleFunc("POST /v1/systemone", s.gatewayDecision)
	mux.HandleFunc("POST /v1/images/generations", s.gatewayImages)
	mux.HandleFunc("POST /v1/videos/generations", s.gatewayVideos)
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

func (s *Server) shutdown(w http.ResponseWriter, _ *http.Request) {
	if s.Stop == nil {
		writeAPIError(w, http.StatusInternalServerError, "shutdown is not available")
		return
	}
	w.WriteHeader(http.StatusNoContent)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	go s.Stop()
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (string, bool) {
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
		writeOpenAIError(w, http.StatusUnauthorized, "Incorrect API key.", "authentication_error", "invalid_api_key")
		return "", false
	}
	return "gw:" + key.Name, true
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
