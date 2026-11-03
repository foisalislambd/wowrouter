package store

import (
	"database/sql"
	"net/url"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/secret"
)

func (s *Store) migrateParity() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret_cipher TEXT NOT NULL DEFAULT '',
  secret_hint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instruction TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  expect TEXT NOT NULL,
  last_status TEXT NOT NULL DEFAULT '',
  last_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget_usd REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_keys (
  team_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  PRIMARY KEY (team_id, key_id)
);
CREATE TABLE IF NOT EXISTS service_bookmarks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_notes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);`)
	return err
}

// QuotaSlot is one saved rate-limit observation.
type QuotaSlot struct {
	Slot          string `json:"slot"`
	Remaining     int    `json:"remaining"`
	Limit         int    `json:"limit"`
	ResetUnix     int64  `json:"resetUnix"`
	CooldownUntil int64  `json:"cooldownUntil"`
	UpdatedAt     string `json:"updatedAt"`
}

func (s *Store) ListQuotaSlots() ([]QuotaSlot, error) {
	rows, err := s.db.Query(`SELECT slot, remaining, limit_n, reset_unix, cooldown_until, updated_at FROM quota_slots ORDER BY updated_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuotaSlot{}
	for rows.Next() {
		var item QuotaSlot
		if err := rows.Scan(&item.Slot, &item.Remaining, &item.Limit, &item.ResetUnix, &item.CooldownUntil, &item.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// CacheStats is the response-cache size.
type CacheStats struct {
	Entries int    `json:"entries"`
	Oldest  string `json:"oldest"`
}

func (s *Store) CacheStats(now time.Time) (CacheStats, error) {
	var stats CacheStats
	err := s.db.QueryRow(`SELECT COUNT(*), COALESCE(MIN(created_at), '') FROM response_cache WHERE expires_at > ?`, now.UTC().Format(time.RFC3339)).
		Scan(&stats.Entries, &stats.Oldest)
	return stats, err
}

func (s *Store) ClearCache() error {
	_, err := s.db.Exec(`DELETE FROM response_cache`)
	return err
}

// CatalogModel is one row in the cross-provider model list.
type CatalogModel struct {
	ID          string  `json:"id"`
	Provider    string  `json:"provider"`
	UpstreamID  string  `json:"upstreamId"`
	DisplayName string  `json:"displayName"`
	Kind        string  `json:"kind"`
	InputUSD    float64 `json:"inputUsdPerMillion"`
	OutputUSD   float64 `json:"outputUsdPerMillion"`
	Active      bool    `json:"active"`
}

func (s *Store) SearchModels(query, kind, sort string, limit, offset int, priced bool) ([]CatalogModel, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	if offset < 0 {
		offset = 0
	}
	where := `WHERE 1 = 1`
	args := []any{}
	if q := strings.TrimSpace(query); q != "" {
		where += ` AND (id LIKE ? OR display_name LIKE ? OR upstream_id LIKE ? OR provider_slug LIKE ?)`
		like := "%" + strings.ReplaceAll(q, "%", "") + "%"
		args = append(args, like, like, like, like)
	}
	if kind = strings.TrimSpace(kind); kind != "" {
		where += ` AND kind = ?`
		args = append(args, kind)
	}
	order := `ORDER BY display_name`
	switch sort {
	case "price":
		order = `ORDER BY input_usd_per_million DESC, display_name`
	case "provider":
		order = `ORDER BY provider_slug, display_name`
	}
	if priced {
		where += ` AND (input_usd_per_million > 0 OR output_usd_per_million > 0)`
		if sort == "" {
			order = `ORDER BY input_usd_per_million DESC, display_name`
		}
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM models `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, limit, offset)
	rows, err := s.db.Query(`
SELECT id, provider_slug, upstream_id, display_name, kind, input_usd_per_million, output_usd_per_million, active
FROM models `+where+` `+order+` LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []CatalogModel{}
	for rows.Next() {
		var item CatalogModel
		var active int
		if err := rows.Scan(&item.ID, &item.Provider, &item.UpstreamID, &item.DisplayName, &item.Kind, &item.InputUSD, &item.OutputUSD, &active); err != nil {
			return nil, 0, err
		}
		item.Active = active == 1
		out = append(out, item)
	}
	return out, total, rows.Err()
}

// FreeProvider is a catalog row marked free.
type FreeProvider struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Summary  string `json:"summary"`
}

func (s *Store) EnabledProviderCount() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM providers WHERE enabled = 1 AND (api_key_cipher <> '' OR key_optional = 1)`).Scan(&n)
	return n, err
}

func FreeProviders() []FreeProvider {
	out := []FreeProvider{}
	for _, provider := range catalog.All() {
		if !provider.Free {
			continue
		}
		out = append(out, FreeProvider{Slug: provider.Slug, Name: provider.DisplayName, Category: provider.Category, Summary: provider.Summary})
	}
	return out
}

// Webhook is an outbound subscription. The secret is never returned.
type Webhook struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Hint      string `json:"hint"`
	Enabled   bool   `json:"enabled"`
	CreatedAt string `json:"createdAt"`
}

func (s *Store) ListWebhooks() ([]Webhook, error) {
	rows, err := s.db.Query(`SELECT id, url, secret_hint, enabled, created_at FROM webhooks ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Webhook{}
	for rows.Next() {
		var item Webhook
		var enabled int
		if err := rows.Scan(&item.ID, &item.URL, &item.Hint, &enabled, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Enabled = enabled == 1
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) AddWebhook(rawURL, hookSecret string) (Webhook, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return Webhook{}, errString("webhook URL must be https, or http on localhost")
	}
	id, err := newID()
	if err != nil {
		return Webhook{}, err
	}
	cipher := ""
	hint := ""
	if strings.TrimSpace(hookSecret) != "" {
		cipher, err = secret.Seal(s.key, strings.TrimSpace(hookSecret))
		if err != nil {
			return Webhook{}, err
		}
		hint = hintSecret(hookSecret)
	}
	item := Webhook{ID: id, URL: parsed.String(), Hint: hint, Enabled: true, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	_, err = s.db.Exec(`INSERT INTO webhooks (id, url, secret_cipher, secret_hint, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
		item.ID, item.URL, cipher, item.Hint, item.CreatedAt)
	return item, err
}

func hintSecret(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 4 {
		return "••••"
	}
	return "••••" + value[len(value)-4:]
}

func (s *Store) DeleteWebhook(id string) error {
	res, err := s.db.Exec(`DELETE FROM webhooks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// WebhookDelivery is a URL plus the opened secret, for one outbound post.
type WebhookDelivery struct {
	URL    string
	Secret string
}

func (s *Store) WebhookDeliveries() ([]WebhookDelivery, error) {
	rows, err := s.db.Query(`SELECT url, secret_cipher FROM webhooks WHERE enabled = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WebhookDelivery{}
	for rows.Next() {
		var item WebhookDelivery
		var cipher string
		if err := rows.Scan(&item.URL, &cipher); err != nil {
			return nil, err
		}
		if cipher != "" {
			item.Secret, err = secret.Open(s.key, cipher)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// Skill is a local instruction the panel can attach to a prompt.
type Skill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Instruction string `json:"instruction"`
	CreatedAt   string `json:"createdAt"`
}

func (s *Store) ListSkills() ([]Skill, error) {
	rows, err := s.db.Query(`SELECT id, name, instruction, created_at FROM skills ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Skill{}
	for rows.Next() {
		var item Skill
		if err := rows.Scan(&item.ID, &item.Name, &item.Instruction, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) AddSkill(name, instruction string) (Skill, error) {
	name = strings.TrimSpace(name)
	instruction = strings.TrimSpace(instruction)
	if name == "" || len(name) > 80 || instruction == "" || len(instruction) > 4000 {
		return Skill{}, errString("a skill needs a name and an instruction up to 4000 characters")
	}
	id, err := newID()
	if err != nil {
		return Skill{}, err
	}
	item := Skill{ID: id, Name: name, Instruction: instruction, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	_, err = s.db.Exec(`INSERT INTO skills (id, name, instruction, created_at) VALUES (?, ?, ?, ?)`, item.ID, item.Name, item.Instruction, item.CreatedAt)
	return item, err
}

func (s *Store) DeleteSkill(id string) error {
	res, err := s.db.Exec(`DELETE FROM skills WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// EvalCase is a saved prompt and the text a reply should contain.
type EvalCase struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ModelID    string `json:"modelId"`
	Prompt     string `json:"prompt"`
	Expect     string `json:"expect"`
	LastStatus string `json:"lastStatus"`
	LastAt     string `json:"lastAt"`
	CreatedAt  string `json:"createdAt"`
}

func (s *Store) ListEvals() ([]EvalCase, error) {
	rows, err := s.db.Query(`SELECT id, name, model_id, prompt, expect, last_status, last_at, created_at FROM eval_cases ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EvalCase{}
	for rows.Next() {
		var item EvalCase
		if err := rows.Scan(&item.ID, &item.Name, &item.ModelID, &item.Prompt, &item.Expect, &item.LastStatus, &item.LastAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) AddEval(name, modelID, prompt, expect string) (EvalCase, error) {
	name, modelID, prompt, expect = strings.TrimSpace(name), strings.TrimSpace(modelID), strings.TrimSpace(prompt), strings.TrimSpace(expect)
	if name == "" || modelID == "" || prompt == "" || expect == "" {
		return EvalCase{}, errString("an eval needs a name, model, prompt, and expected text")
	}
	id, err := newID()
	if err != nil {
		return EvalCase{}, err
	}
	item := EvalCase{ID: id, Name: name, ModelID: modelID, Prompt: prompt, Expect: expect, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	_, err = s.db.Exec(`INSERT INTO eval_cases (id, name, model_id, prompt, expect, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		item.ID, item.Name, item.ModelID, item.Prompt, item.Expect, item.CreatedAt)
	return item, err
}

func (s *Store) GetEval(id string) (EvalCase, error) {
	var item EvalCase
	err := s.db.QueryRow(`SELECT id, name, model_id, prompt, expect, last_status, last_at, created_at FROM eval_cases WHERE id = ?`, id).
		Scan(&item.ID, &item.Name, &item.ModelID, &item.Prompt, &item.Expect, &item.LastStatus, &item.LastAt, &item.CreatedAt)
	if err == sql.ErrNoRows {
		return EvalCase{}, ErrNotFound
	}
	return item, err
}

func (s *Store) SaveEvalResult(id, status string) error {
	_, err := s.db.Exec(`UPDATE eval_cases SET last_status = ?, last_at = ? WHERE id = ?`, status, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

func (s *Store) DeleteEval(id string) error {
	res, err := s.db.Exec(`DELETE FROM eval_cases WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Team is a named group of router keys that share a monthly cap.
type Team struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	MonthlyBudgetUSD *float64 `json:"monthlyBudgetUsd"`
	KeyIDs           []string `json:"keyIds"`
	CreatedAt        string   `json:"createdAt"`
}

func (s *Store) ListTeams() ([]Team, error) {
	rows, err := s.db.Query(`SELECT id, name, monthly_budget_usd, created_at FROM teams ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Team{}
	for rows.Next() {
		var item Team
		var budget sql.NullFloat64
		if err := rows.Scan(&item.ID, &item.Name, &budget, &item.CreatedAt); err != nil {
			return nil, err
		}
		if budget.Valid {
			value := budget.Float64
			item.MonthlyBudgetUSD = &value
		}
		item.KeyIDs, err = s.teamKeys(item.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) teamKeys(id string) ([]string, error) {
	rows, err := s.db.Query(`SELECT key_id FROM team_keys WHERE team_id = ? ORDER BY key_id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var keyID string
		if err := rows.Scan(&keyID); err != nil {
			return nil, err
		}
		out = append(out, keyID)
	}
	return out, rows.Err()
}

func (s *Store) AddTeam(name string, budget *float64, keyIDs []string) (Team, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Team{}, errString("a team needs a name")
	}
	if budget != nil && *budget <= 0 {
		return Team{}, errString("a team budget must be greater than zero")
	}
	id, err := newID()
	if err != nil {
		return Team{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var budgetValue any
	if budget != nil {
		budgetValue = *budget
	}
	if _, err = s.db.Exec(`INSERT INTO teams (id, name, monthly_budget_usd, created_at) VALUES (?, ?, ?, ?)`, id, name, budgetValue, now); err != nil {
		return Team{}, err
	}
	for _, keyID := range keyIDs {
		keyID = strings.TrimSpace(keyID)
		if keyID == "" {
			continue
		}
		if _, err = s.db.Exec(`INSERT INTO team_keys (team_id, key_id) VALUES (?, ?)`, id, keyID); err != nil {
			return Team{}, err
		}
	}
	teams, err := s.ListTeams()
	if err != nil {
		return Team{}, err
	}
	for _, team := range teams {
		if team.ID == id {
			return team, nil
		}
	}
	return Team{}, ErrNotFound
}

func (s *Store) DeleteTeam(id string) error {
	if _, err := s.db.Exec(`DELETE FROM team_keys WHERE team_id = ?`, id); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM teams WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrTeamBudget means the shared team cap is spent.
var ErrTeamBudget = errString("this key's team has reached its monthly budget")

// RejectIfTeamBudget stops a call when any team that contains the key is over its cap.
func (s *Store) RejectIfTeamBudget(keyID string) error {
	if keyID == "" {
		return nil
	}
	rows, err := s.db.Query(`
SELECT t.id, t.monthly_budget_usd FROM teams t
JOIN team_keys tk ON tk.team_id = t.id
WHERE tk.key_id = ? AND t.monthly_budget_usd IS NOT NULL`, keyID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type cap struct {
		id     string
		budget float64
	}
	var caps []cap
	for rows.Next() {
		var item cap
		if err := rows.Scan(&item.id, &item.budget); err != nil {
			return err
		}
		caps = append(caps, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range caps {
		keys, err := s.teamKeys(item.id)
		if err != nil {
			return err
		}
		var spend float64
		for _, member := range keys {
			part, err := s.monthSpend(member)
			if err != nil {
				return err
			}
			spend += part
		}
		if spend >= item.budget {
			return ErrTeamBudget
		}
	}
	return nil
}

// Bookmark is a local service the panel links to. WowRouter does not proxy it.
type Bookmark struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	CreatedAt string `json:"createdAt"`
}

func (s *Store) ListBookmarks() ([]Bookmark, error) {
	rows, err := s.db.Query(`SELECT id, name, url, created_at FROM service_bookmarks ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Bookmark{}
	for rows.Next() {
		var item Bookmark
		if err := rows.Scan(&item.ID, &item.Name, &item.URL, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) AddBookmark(name, rawURL string) (Bookmark, error) {
	name = strings.TrimSpace(name)
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if name == "" || err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return Bookmark{}, errString("a bookmark needs a name and an http(s) URL")
	}
	id, err := newID()
	if err != nil {
		return Bookmark{}, err
	}
	item := Bookmark{ID: id, Name: name, URL: parsed.String(), CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	_, err = s.db.Exec(`INSERT INTO service_bookmarks (id, name, url, created_at) VALUES (?, ?, ?, ?)`, item.ID, item.Name, item.URL, item.CreatedAt)
	return item, err
}

func (s *Store) DeleteBookmark(id string) error {
	res, err := s.db.Exec(`DELETE FROM service_bookmarks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// AgentNote is a record of a local or cloud agent. The router does not run the command.
type AgentNote struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"createdAt"`
}

func (s *Store) ListAgentNotes() ([]AgentNote, error) {
	rows, err := s.db.Query(`SELECT id, name, kind, detail, created_at FROM agent_notes ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AgentNote{}
	for rows.Next() {
		var item AgentNote
		if err := rows.Scan(&item.ID, &item.Name, &item.Kind, &item.Detail, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) AddAgentNote(name, kind, detail string) (AgentNote, error) {
	name, kind, detail = strings.TrimSpace(name), strings.TrimSpace(kind), strings.TrimSpace(detail)
	if name == "" || kind == "" {
		return AgentNote{}, errString("an agent note needs a name and a kind")
	}
	if kind != "cloud" && kind != "cli" && kind != "acp" {
		return AgentNote{}, errString("kind must be cloud, cli, or acp")
	}
	id, err := newID()
	if err != nil {
		return AgentNote{}, err
	}
	item := AgentNote{ID: id, Name: name, Kind: kind, Detail: detail, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	_, err = s.db.Exec(`INSERT INTO agent_notes (id, name, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)`, item.ID, item.Name, item.Kind, item.Detail, item.CreatedAt)
	return item, err
}

func (s *Store) DeleteAgentNote(id string) error {
	res, err := s.db.Exec(`DELETE FROM agent_notes WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ProviderStat groups recent calls by the provider slug in the model id.
type ProviderStat struct {
	Provider   string `json:"provider"`
	Requests   int    `json:"requests"`
	Errors     int    `json:"errors"`
	AvgLatency int    `json:"avgLatencyMs"`
}

func (s *Store) ProviderStats() ([]ProviderStat, error) {
	rows, err := s.db.Query(`
SELECT CASE WHEN instr(model_id, '/') > 0 THEN substr(model_id, 1, instr(model_id, '/') - 1) ELSE model_id END,
       COUNT(*),
       COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0),
       COALESCE(AVG(latency_ms), 0)
FROM request_logs GROUP BY 1 ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProviderStat{}
	for rows.Next() {
		var item ProviderStat
		var avg float64
		if err := rows.Scan(&item.Provider, &item.Requests, &item.Errors, &avg); err != nil {
			return nil, err
		}
		item.AvgLatency = int(avg)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) ListLogsFiltered(source string, limit int) ([]RequestLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `
SELECT id, created_at, source, model_id, status_code, latency_ms, prompt_tokens, completion_tokens, error_message, route_note
FROM request_logs`
	args := []any{}
	if source != "" {
		query += ` WHERE source = ?`
		args = append(args, source)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RequestLog{}
	for rows.Next() {
		var item RequestLog
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Source, &item.ModelID, &item.StatusCode, &item.LatencyMS, &item.PromptTokens, &item.CompletionTokens, &item.ErrorMessage, &item.RouteNote); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) ListBatches() ([]Batch, error) {
	rows, err := s.db.Query(`SELECT id, input_file_id, endpoint, status, output_file_id, error_file_id, request_counts, created_at, completed_at FROM batches ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Batch{}
	for rows.Next() {
		var item Batch
		if err := rows.Scan(&item.ID, &item.InputFileID, &item.Endpoint, &item.Status, &item.OutputFileID, &item.ErrorFileID, &item.RequestCounts, &item.CreatedAt, &item.CompletedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// GuardSettings is the optional local chaos switch and outbound proxy. Both stay off until set.
type GuardSettings struct {
	Chaos         bool   `json:"chaos"`
	ChaosFail     int    `json:"chaosFailPercent"`
	ChaosDelay    int    `json:"chaosDelayMs"`
	RPM           int    `json:"rpm"`
	UpstreamProxy string `json:"upstreamProxy"`
}

func (s *Store) Guards() (GuardSettings, error) {
	var out GuardSettings
	chaos, err := s.setting("chaos_enabled")
	if err != nil {
		return out, err
	}
	out.Chaos = chaos == "1"
	if n, err := atoiSetting(s, "chaos_fail_percent"); err != nil {
		return out, err
	} else {
		out.ChaosFail = n
	}
	if n, err := atoiSetting(s, "chaos_delay_ms"); err != nil {
		return out, err
	} else {
		out.ChaosDelay = n
	}
	if n, err := atoiSetting(s, "rpm_limit"); err != nil {
		return out, err
	} else {
		out.RPM = n
	}
	out.UpstreamProxy, err = s.setting("upstream_proxy")
	return out, err
}

func atoiSetting(s *Store, key string) (int, error) {
	raw, err := s.setting(key)
	if err != nil || raw == "" {
		return 0, err
	}
	n := 0
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0, nil
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

func (s *Store) SaveGuards(in GuardSettings) (GuardSettings, error) {
	if in.ChaosFail < 0 || in.ChaosFail > 100 {
		return GuardSettings{}, errString("chaos fail percent must be from 0 to 100")
	}
	if in.ChaosDelay < 0 || in.ChaosDelay > 2000 {
		return GuardSettings{}, errString("chaos delay must be from 0 to 2000 milliseconds")
	}
	if in.RPM < 0 || in.RPM > 600 {
		return GuardSettings{}, errString("requests per minute must be from 0 to 600")
	}
	proxy := strings.TrimSpace(in.UpstreamProxy)
	if proxy != "" {
		parsed, err := url.Parse(proxy)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return GuardSettings{}, errString("upstream proxy must be an http(s) URL")
		}
		proxy = parsed.String()
	}
	chaos := "0"
	if in.Chaos {
		chaos = "1"
	}
	if err := s.setSetting("chaos_enabled", chaos); err != nil {
		return GuardSettings{}, err
	}
	if err := s.setSetting("chaos_fail_percent", decimal(in.ChaosFail)); err != nil {
		return GuardSettings{}, err
	}
	if err := s.setSetting("chaos_delay_ms", decimal(in.ChaosDelay)); err != nil {
		return GuardSettings{}, err
	}
	if err := s.setSetting("rpm_limit", decimal(in.RPM)); err != nil {
		return GuardSettings{}, err
	}
	if err := s.setSetting("upstream_proxy", proxy); err != nil {
		return GuardSettings{}, err
	}
	return s.Guards()
}

func decimal(n int) string {
	if n == 0 {
		return "0"
	}
	var digits [12]byte
	i := len(digits)
	for n > 0 {
		i--
		digits[i] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[i:])
}
