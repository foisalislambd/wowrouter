package store

import (
	"database/sql"
	"errors"
	"time"
)

// ErrBudget means a router key has used its monthly dollar cap.
var ErrBudget = errors.New("this router key has reached its monthly budget")

// RejectIfOverBudget stops a call when the key's successful spend this UTC month
// is already at the cap. A key with no cap is always allowed.
func (s *Store) RejectIfOverBudget(keyID string) error {
	if keyID == "" {
		return nil
	}
	var budget sql.NullFloat64
	err := s.db.QueryRow(`SELECT monthly_budget_usd FROM router_keys WHERE id = ?`, keyID).Scan(&budget)
	if errors.Is(err, sql.ErrNoRows) || !budget.Valid {
		return nil
	}
	if err != nil {
		return err
	}
	spent, err := s.monthSpend(keyID)
	if err != nil {
		return err
	}
	if spent+1e-9 >= budget.Float64 {
		return ErrBudget
	}
	return nil
}

func (s *Store) monthSpend(keyID string) (float64, error) {
	var spent float64
	err := s.db.QueryRow(`
SELECT COALESCE(SUM((l.prompt_tokens * COALESCE(m.input_usd_per_million, 0) + l.completion_tokens * COALESCE(m.output_usd_per_million, 0)) / 1000000.0), 0)
FROM request_logs l
LEFT JOIN models m ON m.id = l.model_id
WHERE l.router_key_id = ? AND l.status_code < 400 AND l.created_at >= ?`, keyID, monthStartUTC(time.Now())).Scan(&spent)
	return spent, err
}

func monthStartUTC(now time.Time) string {
	year, month, _ := now.UTC().Date()
	return time.Date(year, month, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
}

// UsageDay is one UTC day of successful and failed calls.
type UsageDay struct {
	Day              string  `json:"day"`
	Requests         int     `json:"requests"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	CostUSD          float64 `json:"costUsd"`
}

// UsageDays returns the last n UTC days, including days with no calls.
func (s *Store) UsageDays(n int) ([]UsageDay, error) {
	if n <= 0 || n > 60 {
		n = 14
	}
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1-n)
	rows, err := s.db.Query(`
SELECT substr(l.created_at, 1, 10),
       COUNT(*),
       COALESCE(SUM(l.prompt_tokens), 0),
       COALESCE(SUM(l.completion_tokens), 0),
       COALESCE(SUM((l.prompt_tokens * COALESCE(m.input_usd_per_million, 0) + l.completion_tokens * COALESCE(m.output_usd_per_million, 0)) / 1000000.0), 0)
FROM request_logs l
LEFT JOIN models m ON m.id = l.model_id
WHERE l.created_at >= ?
GROUP BY substr(l.created_at, 1, 10)`, start.Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byDay := map[string]UsageDay{}
	for rows.Next() {
		var item UsageDay
		var requests, prompt, completion float64
		if err := rows.Scan(&item.Day, &requests, &prompt, &completion, &item.CostUSD); err != nil {
			return nil, err
		}
		item.Requests = int(requests)
		item.PromptTokens = int(prompt)
		item.CompletionTokens = int(completion)
		byDay[item.Day] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]UsageDay, 0, n)
	for i := 0; i < n; i++ {
		day := start.AddDate(0, 0, i).Format("2006-01-02")
		item, ok := byDay[day]
		if !ok {
			item = UsageDay{Day: day}
		}
		out = append(out, item)
	}
	return out, nil
}

// TokenCost estimates USD from catalog prices. A zero price stays zero.
func TokenCost(model Model, prompt, completion int) float64 {
	if prompt < 0 {
		prompt = 0
	}
	if completion < 0 {
		completion = 0
	}
	return (float64(prompt)*model.InputUSDPerMillion + float64(completion)*model.OutputUSDPerMillion) / 1_000_000
}
