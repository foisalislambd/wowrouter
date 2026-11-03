package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"airoute/server/internal/catalog"
	"airoute/server/internal/secret"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db  *sql.DB
	key []byte
}

type Provider struct {
	Slug         string `json:"slug"`
	DisplayName  string `json:"displayName"`
	Protocol     string `json:"protocol"`
	BaseURL      string `json:"baseUrl"`
	DocsURL      string `json:"docsUrl"`
	Summary      string `json:"summary"`
	Category     string `json:"category"`
	Free         bool   `json:"free"`
	KeyOptional  bool   `json:"keyOptional"`
	HasAPIKey       bool   `json:"hasApiKey"`
	APIKeyHint      string `json:"apiKeyHint"`
	Enabled         bool   `json:"enabled"`
	AccountStrategy string `json:"accountStrategy"`
	AccountCount    int    `json:"accountCount"`
	ActiveModels    int    `json:"activeModels"`
	TotalModels     int    `json:"totalModels"`
	UpdatedAt       string `json:"updatedAt"`
}

type Model struct {
	ID                  string  `json:"id"`
	ProviderSlug        string  `json:"providerSlug"`
	UpstreamID          string  `json:"upstreamId"`
	DisplayName         string  `json:"displayName"`
	Description         string  `json:"description"`
	ContextWindow       int     `json:"contextWindow"`
	MaxOutputTokens     int     `json:"maxOutputTokens"`
	InputUSDPerMillion  float64 `json:"inputUsdPerMillion"`
	OutputUSDPerMillion float64 `json:"outputUsdPerMillion"`
	KnowledgeCutoff     string  `json:"knowledgeCutoff"`
	Reasoning           bool    `json:"reasoning"`
	Kind                string  `json:"kind"`
	Inputs              string  `json:"inputs"`
	Outputs             string  `json:"outputs"`
	Active              bool    `json:"active"`
}

type Route struct {
	Model      Model
	Protocol   string
	BaseURL    string
	APIKey      string
	AccountID   string
	AccountName string
	ProviderOn  bool
}

type RouterKey struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt"`
}

type CreatedKey struct {
	RouterKey
	Secret string `json:"secret"`
}

type RequestLog struct {
	ID               int64  `json:"id"`
	CreatedAt        string `json:"createdAt"`
	Source           string `json:"source"`
	ModelID          string `json:"modelId"`
	StatusCode       int    `json:"statusCode"`
	LatencyMS        int    `json:"latencyMs"`
	PromptTokens     int    `json:"promptTokens"`
	CompletionTokens int    `json:"completionTokens"`
	ErrorMessage     string `json:"errorMessage"`
	RequestJSON      string `json:"requestJson,omitempty"`
}

type LogInput struct {
	Source           string
	RouterKeyID      string
	ModelID          string
	StatusCode       int
	LatencyMS        int
	PromptTokens     int
	CompletionTokens int
	ErrorMessage     string
	Request          string
}

type UsageRow struct {
	ModelID          string  `json:"modelId"`
	Requests         int     `json:"requests"`
	Errors           int     `json:"errors"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	CostUSD          float64 `json:"costUsd"`
}

type Fallback struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	ModelID   string   `json:"modelId"`
	Models    []string `json:"models"`
	CreatedAt string   `json:"createdAt"`
}

func Open(path string, key []byte) (*Store, error) {
	dsn, err := sqliteDSN(path)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, key: key}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.syncCatalog(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.refreshModalities(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.refreshFacts(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS providers (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_cipher TEXT NOT NULL DEFAULT '',
  api_key_hint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_slug TEXT NOT NULL REFERENCES providers(slug),
  upstream_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  context_window INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  input_usd_per_million REAL NOT NULL,
  output_usd_per_million REAL NOT NULL,
  knowledge_cutoff TEXT NOT NULL DEFAULT '',
  reasoning INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider_slug, upstream_id)
);

CREATE TABLE IF NOT EXISTS router_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  router_key_id TEXT,
  model_id TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
	error_message TEXT NOT NULL DEFAULT ''
);`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE models ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE providers ADD COLUMN key_optional INTEGER NOT NULL DEFAULT 0`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE models ADD COLUMN inputs TEXT NOT NULL DEFAULT 'text'`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE models ADD COLUMN outputs TEXT NOT NULL DEFAULT 'text'`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE models ADD COLUMN modalities_explicit INTEGER NOT NULL DEFAULT 0`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE providers ADD COLUMN models_from_upstream INTEGER NOT NULL DEFAULT 0`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE request_logs ADD COLUMN request_json TEXT NOT NULL DEFAULT ''`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	_, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS fallbacks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fallback_steps (
  fallback_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  PRIMARY KEY (fallback_id, position)
);`)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE providers ADD COLUMN account_strategy TEXT NOT NULL DEFAULT 'fill-first'`)
	if err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	if _, err = s.db.Exec(`
CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  provider_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_cipher TEXT NOT NULL DEFAULT '',
  api_key_hint TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_accounts_slug ON provider_accounts(provider_slug, priority, created_at);`); err != nil {
		return err
	}
	return s.importLegacyAccounts()
}

func (s *Store) syncCatalog() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)
	for _, provider := range catalog.All() {
		optional := 0
		if provider.KeyOptional {
			optional = 1
		}
		if _, err := tx.Exec(`
INSERT INTO providers (slug, display_name, protocol, base_url, key_optional, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(slug) DO UPDATE SET
  display_name = excluded.display_name,
  protocol = excluded.protocol,
  key_optional = excluded.key_optional,
  base_url = CASE WHEN providers.base_url = '' THEN excluded.base_url ELSE providers.base_url END`,
			provider.Slug, provider.DisplayName, provider.Protocol, provider.DefaultBaseURL, optional, now); err != nil {
			return err
		}

		var fromUpstream int
		if err := tx.QueryRow(`SELECT models_from_upstream FROM providers WHERE slug = ?`, provider.Slug).Scan(&fromUpstream); err != nil {
			return err
		}
		if fromUpstream == 1 {
			continue
		}

		keep := make([]string, 0, len(provider.Models))
		for _, model := range provider.Models {
			id := provider.Slug + "/" + model.UpstreamID
			keep = append(keep, model.UpstreamID)
			reasoning := 0
			if model.Reasoning {
				reasoning = 1
			}
			kind := model.Kind
			if kind == "" {
				kind = catalog.KindChat
			}
			inputs, outputs := catalog.Modalities(model.UpstreamID, kind)
			if _, err := tx.Exec(`
INSERT INTO models (
  id, provider_slug, upstream_id, display_name, description,
  context_window, max_output_tokens, input_usd_per_million, output_usd_per_million,
  knowledge_cutoff, reasoning, kind, inputs, outputs, active
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  input_usd_per_million = excluded.input_usd_per_million,
  output_usd_per_million = excluded.output_usd_per_million,
  knowledge_cutoff = excluded.knowledge_cutoff,
  reasoning = excluded.reasoning,
  kind = excluded.kind,
  inputs = excluded.inputs,
  outputs = excluded.outputs`,
				id, provider.Slug, model.UpstreamID, model.DisplayName, model.Description,
				model.ContextWindow, model.MaxOutputTokens, model.InputUSDPerMillion, model.OutputUSDPerMillion,
				model.KnowledgeCutoff, reasoning, kind, inputs, outputs); err != nil {
				return err
			}
		}

		query := `DELETE FROM models WHERE provider_slug = ?`
		args := []any{provider.Slug}
		if len(keep) > 0 {
			query += ` AND upstream_id NOT IN (` + placeholders(len(keep)) + `)`
			for _, id := range keep {
				args = append(args, id)
			}
		}
		if _, err := tx.Exec(query, args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) refreshModalities() error {
	rows, err := s.db.Query(`SELECT id, upstream_id, kind FROM models WHERE modalities_explicit = 0`)
	if err != nil {
		return err
	}
	type row struct {
		id, upstream, kind string
	}
	var items []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.upstream, &item.kind); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, item := range items {
		inputs, outputs := catalog.Modalities(item.upstream, item.kind)
		if _, err := s.db.Exec(`UPDATE models SET inputs = ?, outputs = ? WHERE id = ?`, inputs, outputs, item.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) refreshFacts() error {
	rows, err := s.db.Query(`SELECT id, upstream_id, context_window, max_output_tokens, input_usd_per_million, output_usd_per_million FROM models`)
	if err != nil {
		return err
	}
	type row struct {
		id, upstream       string
		context, maxOutput int
		input, output      float64
	}
	var items []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.upstream, &item.context, &item.maxOutput, &item.input, &item.output); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, item := range items {
		facts := catalog.LookupFacts(item.upstream)
		context, maxOut, input, output := item.context, item.maxOutput, item.input, item.output
		if context == 0 {
			context = facts.ContextWindow
		}
		if maxOut == 0 {
			maxOut = facts.MaxOutput
		}
		if input == 0 {
			input = facts.InputUSDPerMillion
		}
		if output == 0 {
			output = facts.OutputUSDPerMillion
		}
		if context == item.context && maxOut == item.maxOutput && input == item.input && output == item.output {
			continue
		}
		if _, err := s.db.Exec(`UPDATE models SET context_window = ?, max_output_tokens = ?, input_usd_per_million = ?, output_usd_per_million = ? WHERE id = ?`,
			context, maxOut, input, output, item.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListProviders() ([]Provider, error) {
	page, err := s.ListProvidersPage("", "", 0, 0)
	if err != nil {
		return nil, err
	}
	return page.Providers, nil
}

type CategoryStat struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Total int    `json:"total"`
	Ready int    `json:"ready"`
}

type ProviderPage struct {
	Providers  []Provider
	Categories []CategoryStat
	Total      int
	Limit      int
	Offset     int
}

func (s *Store) ListProvidersPage(query, category string, limit, offset int) (ProviderPage, error) {
	unlimited := limit <= 0
	if limit < 0 {
		limit = 24
	}
	if limit > 60 {
		limit = 60
	}
	if offset < 0 {
		offset = 0
	}
	page := ProviderPage{Providers: []Provider{}, Categories: []CategoryStat{}, Limit: limit, Offset: offset}
	stats, err := s.categoryStats()
	if err != nil {
		return ProviderPage{}, err
	}
	page.Categories = stats

	where := "1 = 1"
	args := []any{}
	slugs, filtered := providerFilterSlugs(query, category)
	if filtered {
		if len(slugs) == 0 {
			return page, nil
		}
		where = "p.slug IN (" + placeholders(len(slugs)) + ")"
		for _, slug := range slugs {
			args = append(args, slug)
		}
	}

	countArgs := append([]any{}, args...)
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM providers p WHERE `+where, countArgs...).Scan(&page.Total); err != nil {
		return ProviderPage{}, err
	}

	listSQL := `
SELECT ` + providerColumns + `
FROM providers p
WHERE ` + where + `
ORDER BY
  CASE
    WHEN p.enabled = 1 AND (p.api_key_cipher <> '' OR p.key_optional = 1) THEN 0
    WHEN p.api_key_cipher <> '' OR p.key_optional = 1 THEN 1
    ELSE 2
  END,
  p.display_name COLLATE NOCASE,
  p.slug`
	listArgs := args
	if !unlimited {
		listSQL += ` LIMIT ? OFFSET ?`
		listArgs = append(append([]any{}, args...), limit, offset)
	}
	rows, err := s.db.Query(listSQL, listArgs...)
	if err != nil {
		return ProviderPage{}, err
	}
	defer rows.Close()

	for rows.Next() {
		item, err := scanProvider(rows)
		if err != nil {
			return ProviderPage{}, err
		}
		page.Providers = append(page.Providers, item)
	}
	if page.Providers == nil {
		page.Providers = []Provider{}
	}
	return page, rows.Err()
}

func providerFilterSlugs(query, category string) ([]string, bool) {
	needle := strings.ToLower(strings.TrimSpace(query))
	category = strings.TrimSpace(category)
	wantAll := category == "" || strings.EqualFold(category, "all")
	wantFree := strings.EqualFold(category, "free")
	if needle == "" && wantAll {
		return nil, false
	}
	var slugs []string
	for _, provider := range catalog.All() {
		if needle != "" &&
			!strings.Contains(strings.ToLower(provider.DisplayName), needle) &&
			!strings.Contains(strings.ToLower(provider.Slug), needle) &&
			!strings.Contains(strings.ToLower(provider.Summary), needle) {
			continue
		}
		if wantFree && !provider.Free {
			continue
		}
		if !wantAll && !wantFree && !strings.EqualFold(provider.Category, category) {
			continue
		}
		slugs = append(slugs, provider.Slug)
	}
	return slugs, true
}

func (s *Store) categoryStats() ([]CategoryStat, error) {
	rows, err := s.db.Query(`SELECT slug, enabled, api_key_cipher, key_optional FROM providers`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type tally struct{ total, ready int }
	counts := map[string]*tally{}
	all := tally{}
	free := tally{}
	for rows.Next() {
		var slug, cipher string
		var enabled, optional int
		if err := rows.Scan(&slug, &enabled, &cipher, &optional); err != nil {
			return nil, err
		}
		ready := enabled == 1 && (cipher != "" || optional == 1)
		all.total++
		if ready {
			all.ready++
		}
		def, ok := catalog.BySlug(slug)
		if !ok {
			continue
		}
		name := def.Category
		if name == "" {
			name = "Other"
		}
		item := counts[name]
		if item == nil {
			item = &tally{}
			counts[name] = item
		}
		item.total++
		if ready {
			item.ready++
		}
		if def.Free {
			free.total++
			if ready {
				free.ready++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	stats := []CategoryStat{{ID: "all", Label: "All", Total: all.total, Ready: all.ready}}
	if free.total > 0 {
		stats = append(stats, CategoryStat{ID: "free", Label: "Free", Total: free.total, Ready: free.ready})
	}
	for _, name := range categoryOrder {
		item := counts[name]
		if item == nil || item.total == 0 {
			continue
		}
		stats = append(stats, CategoryStat{ID: name, Label: name, Total: item.total, Ready: item.ready})
		delete(counts, name)
	}
	var rest []string
	for name, item := range counts {
		if item.total > 0 {
			rest = append(rest, name)
		}
	}
	sort.Strings(rest)
	for _, name := range rest {
		item := counts[name]
		stats = append(stats, CategoryStat{ID: name, Label: name, Total: item.total, Ready: item.ready})
	}
	return stats, nil
}

var categoryOrder = []string{
	"Frontier",
	"Gateway",
	"Aggregator",
	"IaaS",
	"Sovereign / Cloud",
	"Specialized",
	"Decisions",
}

func (s *Store) GetProvider(slug string) (Provider, error) {
	row := s.db.QueryRow(`SELECT `+providerColumns+` FROM providers p WHERE p.slug = ?`, slug)
	item, err := scanProvider(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Provider{}, ErrNotFound
	}
	return item, err
}

type ProviderUpdate struct {
	APIKey          *string
	BaseURL         *string
	Enabled         *bool
	AccountStrategy *string
}

func (s *Store) UpdateProvider(slug string, update ProviderUpdate) (Provider, error) {
	current, err := s.GetProvider(slug)
	if err != nil {
		return Provider{}, err
	}

	baseURL := current.BaseURL
	if update.BaseURL != nil {
		baseURL = strings.TrimRight(strings.TrimSpace(*update.BaseURL), "/")
	}
	enabled := current.Enabled
	if update.Enabled != nil {
		enabled = *update.Enabled
	}
	strategy := current.AccountStrategy
	if strategy == "" {
		strategy = strategyFillFirst
	}
	if update.AccountStrategy != nil {
		strategy, err = normalizeStrategy(*update.AccountStrategy)
		if err != nil {
			return Provider{}, err
		}
	}
	if update.APIKey != nil {
		trimmed := strings.TrimSpace(*update.APIKey)
		if trimmed == "" && enabled && !current.KeyOptional {
			keep, err := s.providerHasKeyBesidesPrimary(slug)
			if err != nil {
				return Provider{}, err
			}
			if !keep {
				if current.Category == "Web Cookie" {
					return Provider{}, errors.New("paste a session cookie before enabling this provider")
				}
				return Provider{}, errors.New("add an API key before enabling this provider")
			}
		}
		if err = s.upsertPrimaryAccount(slug, trimmed); err != nil {
			return Provider{}, err
		}
	}
	hasKey, err := s.providerHasKey(slug)
	if err != nil {
		return Provider{}, err
	}
	if enabled && !hasKey && !current.KeyOptional {
		if current.Category == "Web Cookie" {
			return Provider{}, errors.New("paste a session cookie before enabling this provider")
		}
		return Provider{}, errors.New("add an API key before enabling this provider")
	}
	if err = s.writeProviderSettings(slug, baseURL, enabled, strategy); err != nil {
		return Provider{}, err
	}
	return s.GetProvider(slug)
}

func (s *Store) ProviderSecret(slug string) (baseURL, apiKey, protocol string, enabled bool, err error) {
	var cipher string
	var enabledInt int
	err = s.db.QueryRow(`SELECT base_url, api_key_cipher, protocol, enabled FROM providers WHERE slug = ?`, slug).
		Scan(&baseURL, &cipher, &protocol, &enabledInt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", false, ErrNotFound
	}
	if err != nil {
		return "", "", "", false, err
	}
	apiKey, err = secret.Open(s.key, cipher)
	if err != nil {
		return "", "", "", false, err
	}
	return baseURL, apiKey, protocol, enabledInt == 1, nil
}

// LoadedModel is one upstream model id, with modalities when the provider listed them.
type LoadedModel struct {
	UpstreamID          string
	Inputs              string
	Outputs             string
	ContextWindow       int
	MaxOutput           int
	InputUSDPerMillion  float64
	OutputUSDPerMillion float64
}

// ReplaceProviderModels stores the provider's live model list and keeps it across catalog syncs.
// Active flags stay on for ids that are still in the new list.
func (s *Store) ReplaceProviderModels(slug string, upstreamIDs []string) (int, error) {
	loaded := make([]LoadedModel, len(upstreamIDs))
	for i, id := range upstreamIDs {
		loaded[i] = LoadedModel{UpstreamID: id}
	}
	return s.ReplaceLoadedModels(slug, loaded)
}

// ReplaceLoadedModels stores a live model list. Modalities reported by the provider are kept across restarts.
func (s *Store) ReplaceLoadedModels(slug string, loaded []LoadedModel) (int, error) {
	if _, err := s.GetProvider(slug); err != nil {
		return 0, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	type keptModel struct {
		displayName string
		description string
		context     int
		maxOutput   int
		inputPrice  float64
		outputPrice float64
		cutoff      string
		reasoning   int
		kind        string
		active      int
	}
	kept := map[string]keptModel{}
	rows, err := tx.Query(`
SELECT upstream_id, display_name, description, context_window, max_output_tokens,
       input_usd_per_million, output_usd_per_million, knowledge_cutoff, reasoning, kind, active
FROM models WHERE provider_slug = ?`, slug)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var id string
		var item keptModel
		if err := rows.Scan(&id, &item.displayName, &item.description, &item.context, &item.maxOutput,
			&item.inputPrice, &item.outputPrice, &item.cutoff, &item.reasoning, &item.kind, &item.active); err != nil {
			rows.Close()
			return 0, err
		}
		kept[id] = item
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	if _, err := tx.Exec(`DELETE FROM models WHERE provider_slug = ?`, slug); err != nil {
		return 0, err
	}
	for _, loadedModel := range loaded {
		upstreamID := loadedModel.UpstreamID
		item, ok := kept[upstreamID]
		if !ok {
			item = keptModel{
				displayName: upstreamID,
				description: "Loaded from the provider.",
				kind:        catalog.KindFromID(upstreamID),
			}
		}
		inputs, outputs := catalog.Modalities(upstreamID, item.kind)
		explicit := 0
		if loadedModel.Inputs != "" {
			inputs = loadedModel.Inputs
			explicit = 1
		}
		if loadedModel.Outputs != "" {
			outputs = loadedModel.Outputs
			explicit = 1
		}
		facts := catalog.LookupFacts(upstreamID)
		if loadedModel.ContextWindow > 0 {
			item.context = loadedModel.ContextWindow
		} else if item.context == 0 {
			item.context = facts.ContextWindow
		}
		if loadedModel.MaxOutput > 0 {
			item.maxOutput = loadedModel.MaxOutput
		} else if item.maxOutput == 0 {
			item.maxOutput = facts.MaxOutput
		}
		if loadedModel.InputUSDPerMillion > 0 {
			item.inputPrice = loadedModel.InputUSDPerMillion
		} else if item.inputPrice == 0 {
			item.inputPrice = facts.InputUSDPerMillion
		}
		if loadedModel.OutputUSDPerMillion > 0 {
			item.outputPrice = loadedModel.OutputUSDPerMillion
		} else if item.outputPrice == 0 {
			item.outputPrice = facts.OutputUSDPerMillion
		}
		if _, err := tx.Exec(`
INSERT INTO models (
  id, provider_slug, upstream_id, display_name, description,
  context_window, max_output_tokens, input_usd_per_million, output_usd_per_million,
  knowledge_cutoff, reasoning, kind, inputs, outputs, modalities_explicit, active
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			slug+"/"+upstreamID, slug, upstreamID, item.displayName, item.description,
			item.context, item.maxOutput, item.inputPrice, item.outputPrice,
			item.cutoff, item.reasoning, item.kind, inputs, outputs, explicit, item.active); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(`UPDATE providers SET models_from_upstream = 1, updated_at = ? WHERE slug = ?`,
		time.Now().UTC().Format(time.RFC3339), slug); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(loaded), nil
}

type ModelPage struct {
	Models []Model
	Total  int
	Limit  int
	Offset int
}

func (s *Store) ListModelsPage(slug, query string, limit, offset int) (ModelPage, error) {
	if _, err := s.GetProvider(slug); err != nil {
		return ModelPage{}, err
	}
	if limit <= 0 {
		limit = 24
	}
	if limit > 60 {
		limit = 60
	}
	if offset < 0 {
		offset = 0
	}
	where := "provider_slug = ?"
	args := []any{slug}
	query = strings.TrimSpace(query)
	if query != "" {
		where += ` AND (display_name LIKE ? ESCAPE '\' OR upstream_id LIKE ? ESCAPE '\' OR description LIKE ? ESCAPE '\' OR id LIKE ? ESCAPE '\')`
		needle := "%" + escapeLike(query) + "%"
		args = append(args, needle, needle, needle, needle)
	}
	page := ModelPage{Models: []Model{}, Limit: limit, Offset: offset}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM models WHERE `+where, args...).Scan(&page.Total); err != nil {
		return ModelPage{}, err
	}
	rows, err := s.db.Query(`
SELECT id, provider_slug, upstream_id, display_name, description, context_window, max_output_tokens,
       input_usd_per_million, output_usd_per_million, knowledge_cutoff, reasoning, kind, inputs, outputs, active
FROM models WHERE `+where+`
ORDER BY input_usd_per_million DESC, display_name COLLATE NOCASE
LIMIT ? OFFSET ?`, append(append([]any{}, args...), limit, offset)...)
	if err != nil {
		return ModelPage{}, err
	}
	defer rows.Close()
	page.Models, err = scanModels(rows)
	if page.Models == nil {
		page.Models = []Model{}
	}
	return page, err
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func (s *Store) ListModels(slug string) ([]Model, error) {
	if _, err := s.GetProvider(slug); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
SELECT id, provider_slug, upstream_id, display_name, description, context_window, max_output_tokens,
       input_usd_per_million, output_usd_per_million, knowledge_cutoff, reasoning, kind, inputs, outputs, active
FROM models WHERE provider_slug = ?
ORDER BY input_usd_per_million DESC, display_name`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModels(rows)
}

func (s *Store) SetModelActive(slug, upstreamID string, active bool) (Model, error) {
	res, err := s.db.Exec(`UPDATE models SET active = ? WHERE provider_slug = ? AND upstream_id = ?`,
		boolInt(active), slug, upstreamID)
	if err != nil {
		return Model{}, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return Model{}, ErrNotFound
	}
	return s.getModel(slug, upstreamID)
}

func (s *Store) ListActiveModels() ([]Model, error) {
	rows, err := s.db.Query(`
SELECT m.id, m.provider_slug, m.upstream_id, m.display_name, m.description, m.context_window, m.max_output_tokens,
       m.input_usd_per_million, m.output_usd_per_million, m.knowledge_cutoff, m.reasoning, m.kind, m.inputs, m.outputs, m.active
FROM models m
JOIN providers p ON p.slug = m.provider_slug
WHERE m.active = 1 AND p.enabled = 1 AND (p.api_key_cipher != '' OR p.key_optional = 1)
ORDER BY m.display_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModels(rows)
}

func (s *Store) ResolveRoute(modelRef string) (Route, error) {
	modelRef = strings.TrimSpace(modelRef)
	var row *sql.Row
	if strings.Contains(modelRef, "/") {
		row = s.db.QueryRow(`
SELECT m.id, m.provider_slug, m.upstream_id, m.display_name, m.description, m.context_window, m.max_output_tokens,
       m.input_usd_per_million, m.output_usd_per_million, m.knowledge_cutoff, m.reasoning, m.kind, m.inputs, m.outputs, m.active,
       p.protocol, p.base_url, p.api_key_cipher, p.enabled
FROM models m JOIN providers p ON p.slug = m.provider_slug
WHERE m.id = ?`, modelRef)
	} else {
		row = s.db.QueryRow(`
SELECT m.id, m.provider_slug, m.upstream_id, m.display_name, m.description, m.context_window, m.max_output_tokens,
       m.input_usd_per_million, m.output_usd_per_million, m.knowledge_cutoff, m.reasoning, m.kind, m.inputs, m.outputs, m.active,
       p.protocol, p.base_url, p.api_key_cipher, p.enabled
FROM models m JOIN providers p ON p.slug = m.provider_slug
WHERE m.upstream_id = ?`, modelRef)
	}

	var route Route
	var reasoning, active, enabled int
	var cipher string
	err := row.Scan(
		&route.Model.ID, &route.Model.ProviderSlug, &route.Model.UpstreamID, &route.Model.DisplayName,
		&route.Model.Description, &route.Model.ContextWindow, &route.Model.MaxOutputTokens,
		&route.Model.InputUSDPerMillion, &route.Model.OutputUSDPerMillion, &route.Model.KnowledgeCutoff,
		&reasoning, &route.Model.Kind, &route.Model.Inputs, &route.Model.Outputs, &active, &route.Protocol, &route.BaseURL, &cipher, &enabled,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Route{}, ErrNotFound
	}
	if err != nil {
		return Route{}, err
	}
	route.Model.Reasoning = reasoning == 1
	route.Model.Active = active == 1
	route.ProviderOn = enabled == 1
	route.APIKey, err = secret.Open(s.key, cipher)
	return route, err
}

func (s *Store) CreateRouterKey(name string) (CreatedKey, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Default"
	}
	raw := make([]byte, 32)
	idRaw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return CreatedKey{}, err
	}
	if _, err := rand.Read(idRaw); err != nil {
		return CreatedKey{}, err
	}
	secretValue := "sk-airoute-" + hex.EncodeToString(raw)
	id := hex.EncodeToString(idRaw)
	now := time.Now().UTC().Format(time.RFC3339)
	prefix := secretValue[:16] + "…"
	_, err := s.db.Exec(`INSERT INTO router_keys (id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, name, hashKey(secretValue), prefix, now)
	if err != nil {
		return CreatedKey{}, err
	}
	return CreatedKey{
		RouterKey: RouterKey{ID: id, Name: name, Prefix: prefix, CreatedAt: now},
		Secret:    secretValue,
	}, nil
}

func (s *Store) ListRouterKeys() ([]RouterKey, error) {
	rows, err := s.db.Query(`SELECT id, name, key_prefix, created_at, last_used_at FROM router_keys ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RouterKey
	for rows.Next() {
		var item RouterKey
		var last sql.NullString
		if err := rows.Scan(&item.ID, &item.Name, &item.Prefix, &item.CreatedAt, &last); err != nil {
			return nil, err
		}
		if last.Valid {
			item.LastUsedAt = &last.String
		}
		out = append(out, item)
	}
	if out == nil {
		out = []RouterKey{}
	}
	return out, rows.Err()
}

func (s *Store) DeleteRouterKey(id string) error {
	res, err := s.db.Exec(`DELETE FROM router_keys WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AuthenticateRouterKey(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", ErrNotFound
	}
	sum := hashKey(token)
	var id, stored string
	err := s.db.QueryRow(`SELECT id, key_hash FROM router_keys WHERE key_hash = ?`, sum).Scan(&id, &stored)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if subtle.ConstantTimeCompare([]byte(sum), []byte(stored)) != 1 {
		return "", ErrNotFound
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = s.db.Exec(`UPDATE router_keys SET last_used_at = ? WHERE id = ?`, now, id)
	return id, nil
}

const maxStoredLogs = 5000

func (s *Store) AddLog(input LogInput) error {
	_, err := s.db.Exec(`
INSERT INTO request_logs (
  created_at, source, router_key_id, model_id, status_code, latency_ms,
  prompt_tokens, completion_tokens, error_message, request_json
) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339), input.Source, input.RouterKeyID, input.ModelID,
		input.StatusCode, input.LatencyMS, input.PromptTokens, input.CompletionTokens, clipText(input.ErrorMessage, 2000), clipText(input.Request, 100000))
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM request_logs WHERE id <= (SELECT MAX(id) FROM request_logs) - ?`, maxStoredLogs)
	return err
}

func clipText(value string, max int) string {
	if max < 0 || len(value) <= max {
		return value
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut] + "\n… truncated"
}

func (s *Store) ListLogs(limit int) ([]RequestLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.Query(`
SELECT id, created_at, source, model_id, status_code, latency_ms, prompt_tokens, completion_tokens, error_message
FROM request_logs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RequestLog
	for rows.Next() {
		var item RequestLog
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Source, &item.ModelID, &item.StatusCode, &item.LatencyMS, &item.PromptTokens, &item.CompletionTokens, &item.ErrorMessage); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if out == nil {
		out = []RequestLog{}
	}
	return out, rows.Err()
}

func (s *Store) Overview() (providers int, activeModels int, keys int, err error) {
	err = s.db.QueryRow(`SELECT COUNT(*) FROM providers`).Scan(&providers)
	if err != nil {
		return
	}
	err = s.db.QueryRow(`
SELECT COUNT(*) FROM models m
JOIN providers p ON p.slug = m.provider_slug
WHERE m.active = 1 AND p.enabled = 1 AND (p.api_key_cipher != '' OR p.key_optional = 1)`).Scan(&activeModels)
	if err != nil {
		return
	}
	err = s.db.QueryRow(`SELECT COUNT(*) FROM router_keys`).Scan(&keys)
	return
}

func (s *Store) getModel(slug, upstreamID string) (Model, error) {
	row := s.db.QueryRow(`
SELECT id, provider_slug, upstream_id, display_name, description, context_window, max_output_tokens,
       input_usd_per_million, output_usd_per_million, knowledge_cutoff, reasoning, kind, inputs, outputs, active
FROM models WHERE provider_slug = ? AND upstream_id = ?`, slug, upstreamID)
	var item Model
	var reasoning, active int
	err := row.Scan(&item.ID, &item.ProviderSlug, &item.UpstreamID, &item.DisplayName, &item.Description,
		&item.ContextWindow, &item.MaxOutputTokens, &item.InputUSDPerMillion, &item.OutputUSDPerMillion,
		&item.KnowledgeCutoff, &reasoning, &item.Kind, &item.Inputs, &item.Outputs, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return Model{}, ErrNotFound
	}
	item.Reasoning = reasoning == 1
	item.Active = active == 1
	return item, err
}

type scanner interface {
	Scan(dest ...any) error
}

const providerColumns = `
p.slug, p.display_name, p.protocol, p.base_url, p.api_key_cipher, p.api_key_hint,
p.enabled, p.updated_at,
(SELECT COUNT(*) FROM models m WHERE m.provider_slug = p.slug),
(SELECT COUNT(*) FROM models m WHERE m.provider_slug = p.slug AND m.active = 1),
COALESCE(p.account_strategy, 'fill-first'),
(SELECT COUNT(*) FROM provider_accounts a WHERE a.provider_slug = p.slug)`

func scanProvider(row scanner) (Provider, error) {
	var item Provider
	var cipher string
	var enabled int
	err := row.Scan(&item.Slug, &item.DisplayName, &item.Protocol, &item.BaseURL, &cipher, &item.APIKeyHint,
		&enabled, &item.UpdatedAt, &item.TotalModels, &item.ActiveModels, &item.AccountStrategy, &item.AccountCount)
	if err != nil {
		return Provider{}, err
	}
	if item.AccountStrategy == "" {
		item.AccountStrategy = strategyFillFirst
	}
	def, ok := catalog.BySlug(item.Slug)
	if ok {
		item.DocsURL = def.DocsURL
		item.Summary = def.Summary
		item.Category = def.Category
		item.Free = def.Free
		item.KeyOptional = def.KeyOptional
	}
	item.HasAPIKey = cipher != ""
	item.Enabled = enabled == 1
	return item, nil
}

func scanModels(rows *sql.Rows) ([]Model, error) {
	var out []Model
	for rows.Next() {
		var item Model
		var reasoning, active int
		if err := rows.Scan(&item.ID, &item.ProviderSlug, &item.UpstreamID, &item.DisplayName, &item.Description,
			&item.ContextWindow, &item.MaxOutputTokens, &item.InputUSDPerMillion, &item.OutputUSDPerMillion,
			&item.KnowledgeCutoff, &reasoning, &item.Kind, &item.Inputs, &item.Outputs, &active); err != nil {
			return nil, err
		}
		item.Reasoning = reasoning == 1
		item.Active = active == 1
		out = append(out, item)
	}
	if out == nil {
		out = []Model{}
	}
	return out, rows.Err()
}

func hashKey(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func keyHint(value string) string {
	if len(value) <= 4 {
		return "••••"
	}
	return "••••" + value[len(value)-4:]
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func placeholders(n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = "?"
	}
	return strings.Join(parts, ",")
}

func sqliteDSN(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	u := url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(abs)}
	return u.String() + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)", nil
}

func FormatMissing(model string) string {
	return fmt.Sprintf("The model `%s` does not exist or is not active.", model)
}
