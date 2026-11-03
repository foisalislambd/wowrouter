package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"airoute/server/internal/catalog"
)

func (s *Store) GetLog(id int64) (RequestLog, error) {
	var item RequestLog
	err := s.db.QueryRow(`
SELECT id, created_at, source, model_id, status_code, latency_ms, prompt_tokens, completion_tokens, error_message, request_json
FROM request_logs WHERE id = ?`, id).Scan(
		&item.ID, &item.CreatedAt, &item.Source, &item.ModelID, &item.StatusCode, &item.LatencyMS,
		&item.PromptTokens, &item.CompletionTokens, &item.ErrorMessage, &item.RequestJSON,
	)
	if err == sql.ErrNoRows {
		return RequestLog{}, ErrNotFound
	}
	return item, err
}

func (s *Store) ClearLogs() error {
	_, err := s.db.Exec(`DELETE FROM request_logs`)
	return err
}

func (s *Store) CountLogs() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM request_logs`).Scan(&n)
	return n, err
}

func (s *Store) Usage() ([]UsageRow, error) {
	rows, err := s.db.Query(`
SELECT l.model_id, COUNT(*),
       COALESCE(SUM(CASE WHEN l.status_code >= 400 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(l.prompt_tokens), 0),
       COALESCE(SUM(l.completion_tokens), 0),
       COALESCE(SUM((l.prompt_tokens * COALESCE(m.input_usd_per_million, 0) + l.completion_tokens * COALESCE(m.output_usd_per_million, 0)) / 1000000.0), 0)
FROM request_logs l
LEFT JOIN models m ON m.id = l.model_id
GROUP BY l.model_id
ORDER BY COUNT(*) DESC, l.model_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsageRow
	for rows.Next() {
		var item UsageRow
		var requests, errorsN, prompt, completion float64
		if err := rows.Scan(&item.ModelID, &requests, &errorsN, &prompt, &completion, &item.CostUSD); err != nil {
			return nil, err
		}
		item.Requests = int(requests)
		item.Errors = int(errorsN)
		item.PromptTokens = int(prompt)
		item.CompletionTokens = int(completion)
		out = append(out, item)
	}
	if out == nil {
		out = []UsageRow{}
	}
	return out, rows.Err()
}

func (s *Store) ListFallbacks() ([]Fallback, error) {
	rows, err := s.db.Query(`SELECT id, name, created_at FROM fallbacks ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Fallback
	for rows.Next() {
		var item Fallback
		if err := rows.Scan(&item.ID, &item.Name, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.ModelID = "fallback/" + item.ID
		out = append(out, item)
	}
	if out == nil {
		out = []Fallback{}
	}
	for i := range out {
		models, err := s.fallbackModels(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Models = models
	}
	return out, rows.Err()
}

func (s *Store) SaveFallback(name string, models []string) (Fallback, error) {
	id, err := fallbackID(name)
	if err != nil {
		return Fallback{}, err
	}
	if len(models) < 2 {
		return Fallback{}, errFallbackModels
	}
	seen := map[string]bool{}
	clean := make([]string, 0, len(models))
	for _, modelID := range models {
		modelID = strings.TrimSpace(modelID)
		if modelID == "" || seen[modelID] || strings.HasPrefix(modelID, "fallback/") {
			continue
		}
		route, err := s.ResolveRoute(modelID)
		if err != nil {
			return Fallback{}, err
		}
		if err := fallbackStepAllowed(route); err != nil {
			return Fallback{}, err
		}
		seen[modelID] = true
		clean = append(clean, modelID)
	}
	if len(clean) < 2 {
		return Fallback{}, errFallbackModels
	}
	tx, err := s.db.Begin()
	if err != nil {
		return Fallback{}, err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.Exec(`INSERT INTO fallbacks (id, name, created_at) VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET name = excluded.name`, id, strings.TrimSpace(name), now); err != nil {
		return Fallback{}, err
	}
	if _, err := tx.Exec(`DELETE FROM fallback_steps WHERE fallback_id = ?`, id); err != nil {
		return Fallback{}, err
	}
	for i, modelID := range clean {
		if _, err := tx.Exec(`INSERT INTO fallback_steps (fallback_id, position, model_id) VALUES (?, ?, ?)`, id, i, modelID); err != nil {
			return Fallback{}, err
		}
	}
	var created string
	if err := tx.QueryRow(`SELECT created_at FROM fallbacks WHERE id = ?`, id).Scan(&created); err != nil {
		return Fallback{}, err
	}
	if err := tx.Commit(); err != nil {
		return Fallback{}, err
	}
	return Fallback{ID: id, Name: strings.TrimSpace(name), ModelID: "fallback/" + id, Models: clean, CreatedAt: created}, nil
}

func (s *Store) DeleteFallback(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM fallbacks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(`DELETE FROM fallback_steps WHERE fallback_id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ResolveChain(modelRef string) ([]Route, error) {
	modelRef = strings.TrimSpace(modelRef)
	if !strings.HasPrefix(modelRef, "fallback/") {
		route, err := s.ResolveRoute(modelRef)
		if err != nil {
			return nil, err
		}
		return []Route{route}, nil
	}
	models, err := s.fallbackModels(strings.TrimPrefix(modelRef, "fallback/"))
	if err != nil {
		return nil, err
	}
	if len(models) == 0 {
		return nil, ErrNotFound
	}
	routes := make([]Route, 0, len(models))
	for _, modelID := range models {
		route, err := s.ResolveRoute(modelID)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
	if len(routes) == 0 {
		return nil, ErrFallbackEmpty
	}
	return routes, nil
}

func (s *Store) fallbackModels(id string) ([]string, error) {
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM fallbacks WHERE id = ?`, id).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, ErrNotFound
	}
	rows, err := s.db.Query(`SELECT model_id FROM fallback_steps WHERE fallback_id = ? ORDER BY position`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var modelID string
		if err := rows.Scan(&modelID); err != nil {
			return nil, err
		}
		out = append(out, modelID)
	}
	if out == nil {
		out = []string{}
	}
	return out, rows.Err()
}

var errFallbackModels = errString("add at least two different models")

var ErrFallbackEmpty = errors.New("every model in this fallback was removed")

type errString string

func (e errString) Error() string { return string(e) }

func fallbackStepAllowed(route Route) error {
	if route.Protocol != catalog.ProtocolOpenAIChat {
		return errString(route.Model.ID + " is not an OpenAI-compatible chat model")
	}
	if route.Model.Kind != "" && route.Model.Kind != catalog.KindChat {
		return errString(route.Model.ID + " is not a chat model")
	}
	if strings.TrimSpace(route.BaseURL) == "" {
		return errString("set a base URL for " + route.Model.ProviderSlug + " before adding it")
	}
	if !route.Model.Active || !route.ProviderOn {
		return errString(route.Model.ID + " is turned off")
	}
	if route.APIKey == "" {
		provider, ok := catalog.BySlug(route.Model.ProviderSlug)
		if !ok || !provider.KeyOptional {
			return errString("save an API key for " + route.Model.ProviderSlug + " before adding it")
		}
	}
	return nil
}

func fallbackID(name string) (string, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	dash := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 && !dash {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	id := strings.Trim(b.String(), "-")
	if id == "" || len(id) > 40 {
		return "", errString("use a short name with letters or numbers")
	}
	return id, nil
}
