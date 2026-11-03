package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"airoute/server/internal/assist"
	"airoute/server/internal/store"
)

func (s *Server) parityRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/catalog/models", s.catalogModels)
	mux.HandleFunc("GET /api/catalog/free", s.freeProviders)
	mux.HandleFunc("GET /api/quota", s.quotaSlots)
	mux.HandleFunc("GET /api/cache", s.cacheStats)
	mux.HandleFunc("DELETE /api/cache", s.clearCache)
	mux.HandleFunc("GET /api/endpoints", s.endpoints)
	mux.HandleFunc("GET /api/health/detail", s.healthDetail)
	mux.HandleFunc("GET /api/costs", s.costs)
	mux.HandleFunc("GET /api/provider-stats", s.providerStats)
	mux.HandleFunc("GET /api/webhooks", s.listWebhooks)
	mux.HandleFunc("POST /api/webhooks", s.addWebhook)
	mux.HandleFunc("DELETE /api/webhooks/{id}", s.deleteWebhook)
	mux.HandleFunc("GET /api/skills", s.listSkills)
	mux.HandleFunc("POST /api/skills", s.addSkill)
	mux.HandleFunc("DELETE /api/skills/{id}", s.deleteSkill)
	mux.HandleFunc("GET /api/evals", s.listEvals)
	mux.HandleFunc("POST /api/evals", s.addEval)
	mux.HandleFunc("POST /api/evals/{id}/run", s.runEval)
	mux.HandleFunc("DELETE /api/evals/{id}", s.deleteEval)
	mux.HandleFunc("GET /api/teams", s.listTeams)
	mux.HandleFunc("POST /api/teams", s.addTeam)
	mux.HandleFunc("DELETE /api/teams/{id}", s.deleteTeam)
	mux.HandleFunc("GET /api/bookmarks", s.listBookmarks)
	mux.HandleFunc("POST /api/bookmarks", s.addBookmark)
	mux.HandleFunc("DELETE /api/bookmarks/{id}", s.deleteBookmark)
	mux.HandleFunc("GET /api/agents", s.listAgents)
	mux.HandleFunc("POST /api/agents", s.addAgent)
	mux.HandleFunc("DELETE /api/agents/{id}", s.deleteAgent)
	mux.HandleFunc("GET /api/guards", s.getGuards)
	mux.HandleFunc("PUT /api/guards", s.saveGuards)
	mux.HandleFunc("POST /api/compression/preview", s.compressionPreview)
	mux.HandleFunc("POST /api/translate", s.translate)
	mux.HandleFunc("GET /api/audit", s.audit)
	mux.HandleFunc("GET /api/activity/export", s.exportActivity)
	mux.HandleFunc("GET /api/changelog", s.changelog)
	mux.HandleFunc("GET /api/onboarding", s.onboarding)
	mux.HandleFunc("GET /api/files/local", s.localFiles)
	mux.HandleFunc("GET /api/batches/local", s.localBatches)
	mux.HandleFunc("GET /api/console", s.consoleFeed)
}

func (s *Server) catalogModels(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	priced := r.URL.Query().Get("priced") == "1"
	items, err := s.Store.SearchModels(r.URL.Query().Get("q"), r.URL.Query().Get("kind"), limit, priced)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": items})
}

func (s *Server) freeProviders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": store.FreeProviders()})
}

func (s *Server) quotaSlots(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListQuotaSlots()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slots": items})
}

func (s *Server) cacheStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := s.Store.CacheStats(time.Now())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	features, _ := s.Store.Features()
	writeJSON(w, http.StatusOK, map[string]any{"entries": stats.Entries, "oldest": stats.Oldest, "enabled": features.Cache, "ttl": features.CacheTTL})
}

func (s *Server) clearCache(w http.ResponseWriter, _ *http.Request) {
	if err := s.Store.ClearCache(); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.noteConsole("response cache cleared")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) endpoints(w http.ResponseWriter, r *http.Request) {
	base := "http://" + r.Host
	writeJSON(w, http.StatusOK, map[string]any{"base": base, "routes": []map[string]string{
		{"method": "POST", "path": "/v1/chat/completions", "use": "OpenAI chat"},
		{"method": "POST", "path": "/v1/messages", "use": "Anthropic messages"},
		{"method": "POST", "path": "/v1/messages/count_tokens", "use": "Token count"},
		{"method": "POST", "path": "/v1/responses", "use": "Responses"},
		{"method": "GET", "path": "/v1/models", "use": "Active models"},
		{"method": "POST", "path": "/v1/models/query", "use": "Ranked model search"},
		{"method": "POST", "path": "/v1/images/generations", "use": "Images"},
		{"method": "POST", "path": "/v1/videos/generations", "use": "Videos"},
		{"method": "POST", "path": "/v1/systemone", "use": "Decisions"},
		{"method": "POST", "path": "/v1/files", "use": "Batch input files"},
		{"method": "POST", "path": "/v1/batches", "use": "Batch jobs"},
		{"method": "POST", "path": "/mcp", "use": "MCP tools"},
		{"method": "POST", "path": "/a2a", "use": "Agent-to-agent"},
		{"method": "GET", "path": "/.well-known/agent-card.json", "use": "Agent card"},
		{"method": "GET", "path": "/health", "use": "Process health"},
	}})
}

func (s *Server) healthDetail(w http.ResponseWriter, _ *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	logs, _ := s.Store.CountLogs()
	providers, active, keys, err := s.Store.Overview()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stats, _ := s.Store.ProviderStats()
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "uptimeSec": int(time.Since(s.started).Seconds()),
		"go": runtime.Version(), "dataDir": s.DataDir, "addr": s.Addr,
		"allocMb": mem.Alloc / (1 << 20), "logs": logs,
		"providers": providers, "activeModels": active, "keys": keys,
		"providersStats": stats,
	})
}

func (s *Server) costs(w http.ResponseWriter, _ *http.Request) {
	rows, err := s.Store.Usage()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var total float64
	for _, row := range rows {
		total += row.CostUSD
	}
	priced, _ := s.Store.SearchModels("", "", 30, true)
	writeJSON(w, http.StatusOK, map[string]any{"totalUsd": total, "byModel": rows, "prices": priced})
}

func (s *Server) providerStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := s.Store.ProviderStats()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": stats})
}

func (s *Server) listWebhooks(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListWebhooks()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": items})
}

func (s *Server) addWebhook(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL    string `json:"url"`
		Secret string `json:"secret"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddWebhook(body.URL, body.Secret)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.noteConsole("webhook saved")
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteWebhook(r.PathValue("id")); err != nil {
		writeAPIError(w, http.StatusNotFound, "webhook not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listSkills(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListSkills()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"skills": items})
}

func (s *Server) addSkill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Instruction string `json:"instruction"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddSkill(body.Name, body.Instruction)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteSkill(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteSkill(r.PathValue("id")); err != nil {
		writeAPIError(w, http.StatusNotFound, "skill not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listEvals(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListEvals()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"evals": items})
}

func (s *Server) addEval(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		ModelID string `json:"modelId"`
		Prompt  string `json:"prompt"`
		Expect  string `json:"expect"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddEval(body.Name, body.ModelID, body.Prompt, body.Expect)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) runEval(w http.ResponseWriter, r *http.Request) {
	item, err := s.Store.GetEval(r.PathValue("id"))
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "eval not found")
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"model":    item.ModelID,
		"messages": []map[string]string{{"role": "user", "content": item.Prompt}},
	})
	req, _ := http.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(payload))
	req = req.WithContext(r.Context())
	rec := &captureWriter{header: http.Header{}}
	s.proxyChat(rec, req, "eval", "")
	status := "fail"
	if rec.status < 400 && strings.Contains(rec.body.String(), item.Expect) {
		status = "pass"
	}
	_ = s.Store.SaveEvalResult(item.ID, status)
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "http": rec.status, "body": clip(rec.body.String(), 2000)})
}

func (s *Server) deleteEval(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteEval(r.PathValue("id")); err != nil {
		writeAPIError(w, http.StatusNotFound, "eval not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listTeams(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListTeams()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"teams": items})
}

func (s *Server) addTeam(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name             string   `json:"name"`
		MonthlyBudgetUSD *float64 `json:"monthlyBudgetUsd"`
		KeyIDs           []string `json:"keyIds"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddTeam(body.Name, body.MonthlyBudgetUSD, body.KeyIDs)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteTeam(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteTeam(r.PathValue("id")); err != nil {
		writeAPIError(w, http.StatusNotFound, "team not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listBookmarks(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListBookmarks()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bookmarks": items})
}

func (s *Server) addBookmark(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddBookmark(body.Name, body.URL)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteBookmark(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteBookmark(r.PathValue("id")); err != nil {
		writeAPIError(w, http.StatusNotFound, "bookmark not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listAgents(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListAgentNotes()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	recent, _ := s.Store.ListLogsFiltered("", 30)
	writeJSON(w, http.StatusOK, map[string]any{"agents": items, "recent": recent})
}

func (s *Server) addAgent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name   string `json:"name"`
		Kind   string `json:"kind"`
		Detail string `json:"detail"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddAgentNote(body.Name, body.Kind, body.Detail)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteAgent(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteAgentNote(r.PathValue("id")); err != nil {
		writeAPIError(w, http.StatusNotFound, "agent not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getGuards(w http.ResponseWriter, _ *http.Request) {
	guards, err := s.Store.Guards()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, guards)
}

func (s *Server) saveGuards(w http.ResponseWriter, r *http.Request) {
	var body store.GuardSettings
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	saved, err := s.Store.SaveGuards(body)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.applyUpstreamProxy(saved.UpstreamProxy); err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.noteConsole("guards saved")
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) applyUpstreamProxy(raw string) error {
	if s.OpenAI == nil || s.OpenAI.HTTP == nil {
		return nil
	}
	transport, ok := s.OpenAI.HTTP.Transport.(*http.Transport)
	if !ok {
		return nil
	}
	if strings.TrimSpace(raw) == "" {
		transport.Proxy = nil
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return err
	}
	transport.Proxy = http.ProxyURL(parsed)
	return nil
}

func (s *Server) compressionPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
		Text string `json:"text"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !assist.KnownMode(body.Mode) {
		writeAPIError(w, http.StatusBadRequest, "that compressor is not bundled. Use light, caveman, dedup, headroom, rtk, terse, or ultra.")
		return
	}
	out := assist.Rewrite(body.Text, body.Mode)
	writeJSON(w, http.StatusOK, map[string]any{"text": out, "before": len(body.Text), "after": len(out)})
}

func (s *Server) translate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Direction string          `json:"direction"`
		Body      json.RawMessage `json:"body"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	out, err := convertWire(body.Direction, body.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"body": json.RawMessage(out)})
}

func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	if source == "" {
		source = "mcp"
	}
	if source != "mcp" && source != "a2a" && source != "eval" && source != "batch" {
		writeAPIError(w, http.StatusBadRequest, "source must be mcp, a2a, eval, or batch")
		return
	}
	items, err := s.Store.ListLogsFiltered(source, 100)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": items})
}

func (s *Server) exportActivity(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListLogsFiltered("", 500)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=wowrouter-activity.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "createdAt", "source", "modelId", "status", "latencyMs", "promptTokens", "completionTokens", "error"})
	for _, item := range items {
		_ = cw.Write([]string{
			strconv.FormatInt(item.ID, 10), item.CreatedAt, item.Source, item.ModelID,
			strconv.Itoa(item.StatusCode), strconv.Itoa(item.LatencyMS),
			strconv.Itoa(item.PromptTokens), strconv.Itoa(item.CompletionTokens), item.ErrorMessage,
		})
	}
	cw.Flush()
}

func (s *Server) changelog(w http.ResponseWriter, _ *http.Request) {
	text := readChangelog(s.WebDir)
	if text == "" {
		text = readChangelog(s.DataDir)
	}
	writeJSON(w, http.StatusOK, map[string]any{"markdown": text})
}

func readChangelog(start string) string {
	dir := start
	if dir == "" {
		dir, _ = os.Getwd()
	}
	for range 6 {
		candidate := filepath.Join(dir, "CHANGELOG.md")
		if body, err := os.ReadFile(candidate); err == nil {
			return string(body)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func (s *Server) onboarding(w http.ResponseWriter, _ *http.Request) {
	_, active, keys, err := s.Store.Overview()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	enabled, err := s.Store.EnabledProviderCount()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	locked, _ := s.Store.PanelLocked()
	writeJSON(w, http.StatusOK, map[string]any{
		"steps": []map[string]any{
			{"id": "provider", "label": "Save a provider key and turn the provider on", "done": enabled > 0},
			{"id": "model", "label": "Turn on one chat model", "done": active > 0},
			{"id": "key", "label": "Create a router key", "done": keys > 0},
			{"id": "password", "label": "Panel password stays off until you opt in", "done": !locked},
		},
	})
}

func (s *Server) localFiles(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListFiles()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": items})
}

func (s *Server) localBatches(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListBatches()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"batches": items})
}

func (s *Server) consoleFeed(w http.ResponseWriter, _ *http.Request) {
	s.consoleMu.Lock()
	lines := append([]string(nil), s.consoleLog...)
	s.consoleMu.Unlock()
	if lines == nil {
		lines = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"lines": lines})
}

func (s *Server) noteConsole(line string) {
	s.consoleMu.Lock()
	defer s.consoleMu.Unlock()
	s.consoleLog = append(s.consoleLog, time.Now().UTC().Format(time.RFC3339)+" "+line)
	if len(s.consoleLog) > 80 {
		s.consoleLog = s.consoleLog[len(s.consoleLog)-80:]
	}
}

func (s *Server) deliverWebhooks(input store.LogInput) {
	hooks, err := s.Store.WebhookDeliveries()
	if err != nil || len(hooks) == 0 || s.OpenAI == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"source": input.Source, "model": input.ModelID, "status": input.StatusCode, "at": time.Now().UTC().Format(time.RFC3339),
	})
	for _, hook := range hooks {
		header := http.Header{}
		header.Set("Content-Type", "application/json")
		if hook.Secret != "" {
			mac := hmac.New(sha256.New, []byte(hook.Secret))
			_, _ = mac.Write(payload)
			header.Set("X-WowRouter-Signature", hex.EncodeToString(mac.Sum(nil)))
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		resp, err := s.OpenAI.Send(ctx, http.MethodPost, hook.URL, payload, header)
		cancel()
		if err != nil {
			s.noteConsole("webhook " + hook.URL + " " + err.Error())
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		s.noteConsole("webhook " + hook.URL + " " + resp.Status)
	}
}

func (s *Server) chaosGate(keyID string) (int, string, bool) {
	guards, err := s.Store.Guards()
	if err != nil {
		return 0, "", false
	}
	if guards.RPM > 0 && keyID != "" && !s.allowRPM(keyID, guards.RPM) {
		return http.StatusTooManyRequests, "this router key is over its requests-per-minute limit", true
	}
	if !guards.Chaos {
		return 0, "", false
	}
	if guards.ChaosDelay > 0 {
		time.Sleep(time.Duration(guards.ChaosDelay) * time.Millisecond)
	}
	if guards.ChaosFail >= 100 || (guards.ChaosFail > 0 && rand.Intn(100) < guards.ChaosFail) {
		return http.StatusServiceUnavailable, "chaos mode rejected this call", true
	}
	return 0, "", false
}

func (s *Server) allowRPM(keyID string, limit int) bool {
	s.rpmMu.Lock()
	defer s.rpmMu.Unlock()
	if s.rpmHits == nil {
		s.rpmHits = map[string][]time.Time{}
	}
	now := time.Now()
	cut := now.Add(-time.Minute)
	kept := s.rpmHits[keyID][:0]
	for _, at := range s.rpmHits[keyID] {
		if at.After(cut) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		s.rpmHits[keyID] = kept
		return false
	}
	s.rpmHits[keyID] = append(kept, now)
	return true
}

type captureWriter struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (c *captureWriter) Header() http.Header { return c.header }
func (c *captureWriter) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
	}
}
func (c *captureWriter) Write(p []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	return c.body.Write(p)
}

func convertWire(direction string, body []byte) ([]byte, error) {
	var parsed struct {
		Model    string `json:"model"`
		System   string `json:"system"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, errString("body must be JSON with text messages")
	}
	switch direction {
	case "openai-to-anthropic":
		system := ""
		messages := []map[string]string{}
		for _, message := range parsed.Messages {
			if message.Role == "system" {
				system = message.Content
				continue
			}
			messages = append(messages, map[string]string{"role": message.Role, "content": message.Content})
		}
		return json.Marshal(map[string]any{"model": parsed.Model, "system": system, "messages": messages, "max_tokens": 1024})
	case "anthropic-to-openai":
		messages := []map[string]string{}
		if parsed.System != "" {
			messages = append(messages, map[string]string{"role": "system", "content": parsed.System})
		}
		for _, message := range parsed.Messages {
			messages = append(messages, map[string]string{"role": message.Role, "content": message.Content})
		}
		return json.Marshal(map[string]any{"model": parsed.Model, "messages": messages})
	default:
		return nil, errString("direction must be openai-to-anthropic or anthropic-to-openai")
	}
}

func clip(text string, max int) string {
	if len(text) <= max {
		return text
	}
	return text[:max]
}
