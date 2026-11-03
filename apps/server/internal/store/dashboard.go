package store

import (
	"strings"
	"time"
)

// TodayStats is the current UTC day's call volume.
type TodayStats struct {
	Requests   int     `json:"requests"`
	Errors     int     `json:"errors"`
	AvgLatency int     `json:"avgLatencyMs"`
	CostUSD    float64 `json:"costUsd"`
}

func (s *Store) Today() (TodayStats, error) {
	day := time.Now().UTC().Format("2006-01-02")
	var stats TodayStats
	var requests, errorsN, avg float64
	err := s.db.QueryRow(`
SELECT COUNT(*),
       COALESCE(SUM(CASE WHEN l.status_code >= 400 THEN 1 ELSE 0 END), 0),
       COALESCE(AVG(l.latency_ms), 0),
       COALESCE(SUM((l.prompt_tokens * COALESCE(m.input_usd_per_million, 0) + l.completion_tokens * COALESCE(m.output_usd_per_million, 0)) / 1000000.0), 0)
FROM request_logs l
LEFT JOIN models m ON m.id = l.model_id
WHERE substr(l.created_at, 1, 10) = ?`, day).Scan(&requests, &errorsN, &avg, &stats.CostUSD)
	stats.Requests = int(requests)
	stats.Errors = int(errorsN)
	stats.AvgLatency = int(avg)
	return stats, err
}

// ProviderCallStats summarizes logs whose model id starts with the provider slug.
func (s *Store) ProviderCallStats(slug string) (requests, errorsN, avg int, err error) {
	var req, errCount, latency float64
	err = s.db.QueryRow(`
SELECT COUNT(*),
       COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0),
       COALESCE(AVG(latency_ms), 0)
FROM request_logs
WHERE model_id = ? OR model_id LIKE ?`, slug, slug+"/%").Scan(&req, &errCount, &latency)
	return int(req), int(errCount), int(latency), err
}

// SearchLogs filters stored calls by text and status.
func (s *Store) SearchLogs(query, status string, limit, offset int) ([]RequestLog, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	where := "1 = 1"
	args := []any{}
	if q := strings.TrimSpace(query); q != "" {
		like := "%" + strings.NewReplacer("%", "", "_", "").Replace(q) + "%"
		where += " AND (model_id LIKE ? OR source LIKE ? OR error_message LIKE ? OR route_note LIKE ?)"
		args = append(args, like, like, like, like)
	}
	switch status {
	case "error":
		where += " AND status_code >= 400"
	case "ok":
		where += " AND status_code > 0 AND status_code < 400"
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM request_logs WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(`
SELECT id, created_at, source, model_id, status_code, latency_ms, prompt_tokens, completion_tokens, error_message, route_note
FROM request_logs WHERE `+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []RequestLog{}
	for rows.Next() {
		var item RequestLog
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Source, &item.ModelID, &item.StatusCode, &item.LatencyMS, &item.PromptTokens, &item.CompletionTokens, &item.ErrorMessage, &item.RouteNote); err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, total, rows.Err()
}
