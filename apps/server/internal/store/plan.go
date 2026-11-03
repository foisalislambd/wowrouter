package store

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/routeplan"
)

const autoTryLimit = 4

// ErrNoAutoCandidates means auto was asked for before any chat model was ready.
var ErrNoAutoCandidates = errors.New("turn on a chat model before using auto")

// Plan is the ordered list of models a chat call should try.
type Plan struct {
	Asked    string
	Strategy string
	Routes   []Route
}

func normalizeCombo(value string) (string, error) {
	return routeplan.NormalizeStrategy(value)
}

// ResolvePlan turns a public model id into an ordered try-list.
// auto and auto/cheap, auto/fast, and auto/coding are built from models that are already on.
func (s *Store) ResolvePlan(modelRef string) (Plan, error) {
	modelRef = strings.TrimSpace(modelRef)
	if profile, ok := routeplan.AutoProfile(modelRef); ok {
		return s.resolveAuto(modelRef, profile)
	}
	if strings.HasPrefix(modelRef, "fallback/") {
		return s.resolveCombo(modelRef)
	}
	route, err := s.ResolveRoute(modelRef)
	if err != nil {
		return Plan{}, err
	}
	return Plan{Asked: modelRef, Strategy: routeplan.StrategyDirect, Routes: []Route{route}}, nil
}

func (s *Store) resolveAuto(asked, profile string) (Plan, error) {
	items, err := s.chatCandidates()
	if err != nil {
		return Plan{}, err
	}
	ranked := routeplan.Rank(profile, items)
	if len(ranked) == 0 {
		return Plan{}, ErrNoAutoCandidates
	}
	if len(ranked) > autoTryLimit {
		ranked = ranked[:autoTryLimit]
	}
	routes := make([]Route, 0, len(ranked))
	for _, item := range ranked {
		route, err := s.ResolveRoute(item.ID)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return Plan{}, err
		}
		routes = append(routes, route)
	}
	if len(routes) == 0 {
		return Plan{}, ErrNoAutoCandidates
	}
	return Plan{Asked: asked, Strategy: routeplan.AutoStrategy(profile), Routes: routes}, nil
}

func (s *Store) resolveCombo(modelRef string) (Plan, error) {
	id := strings.TrimPrefix(modelRef, "fallback/")
	var strategy string
	if err := s.db.QueryRow(`SELECT strategy FROM fallbacks WHERE id = ?`, id).Scan(&strategy); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Plan{}, ErrNotFound
		}
		return Plan{}, err
	}
	strategy, err := normalizeCombo(strategy)
	if err != nil {
		strategy = routeplan.StrategyPriority
	}
	models, weights, err := s.fallbackSteps(id)
	if err != nil {
		return Plan{}, err
	}
	routes := make([]Route, 0, len(models))
	usedWeights := make([]int, 0, len(models))
	for i, modelID := range models {
		route, err := s.ResolveRoute(modelID)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return Plan{}, err
		}
		weight := 1
		if i < len(weights) {
			weight = weights[i]
		}
		routes = append(routes, route)
		usedWeights = append(usedWeights, weight)
	}
	if len(routes) == 0 {
		return Plan{}, ErrFallbackEmpty
	}
	order, err := s.comboOrder(id, strategy, routes, usedWeights)
	if err != nil {
		return Plan{}, err
	}
	ordered := make([]Route, len(routes))
	for i, index := range order {
		ordered[i] = routes[index]
	}
	return Plan{Asked: modelRef, Strategy: strategy, Routes: ordered}, nil
}

func (s *Store) comboOrder(id, strategy string, routes []Route, weights []int) ([]int, error) {
	n := len(routes)
	cursor := 0
	roll := 0
	var costs []float64
	var counts []int
	switch strategy {
	case routeplan.StrategyRoundRobin:
		start, err := s.bumpCursor("combo:"+id, n)
		if err != nil {
			return nil, err
		}
		cursor = start
	case routeplan.StrategyWeighted:
		sum := 0
		for _, weight := range weights {
			if weight < 1 {
				weight = 1
			}
			sum += weight
		}
		if sum < 1 {
			sum = 1
		}
		picked, err := rand.Int(rand.Reader, big.NewInt(int64(sum)))
		if err != nil {
			return nil, err
		}
		roll = int(picked.Int64())
	case routeplan.StrategyCost:
		costs = make([]float64, n)
		for i, route := range routes {
			costs[i] = routeplan.BlendedPrice(route.Model.InputUSDPerMillion, route.Model.OutputUSDPerMillion)
		}
	case routeplan.StrategyLeastUsed:
		ids := make([]string, n)
		for i, route := range routes {
			ids[i] = route.Model.ID
		}
		usage, err := s.requestCounts(ids)
		if err != nil {
			return nil, err
		}
		counts = make([]int, n)
		for i, modelID := range ids {
			counts[i] = usage[modelID]
		}
	case routeplan.StrategyFillFirst, routeplan.StrategyHeadroom, routeplan.StrategyResetWindow,
		routeplan.StrategyQuotaWeighted, routeplan.StrategyQuotaShare:
		ids := make([]string, n)
		for i, route := range routes {
			ids[i] = route.Model.ID
		}
		windows, err := s.QuotaWindows(ids, time.Now())
		if err != nil {
			return nil, err
		}
		return routeplan.OrderWindows(strategy, n, windows, time.Now())
	}
	return routeplan.Order(strategy, n, weights, costs, counts, cursor, roll)
}

// RankedChatModels returns ready chat models ordered for a profile.
func (s *Store) RankedChatModels(profile, query string, minContext int, reasoning *bool, limit int) ([]routeplan.Candidate, error) {
	items, err := s.chatCandidates()
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	filtered := items[:0]
	for _, item := range items {
		if minContext > 0 && item.Context < minContext {
			continue
		}
		if reasoning != nil && item.Reasoning != *reasoning {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(item.ID+" "+item.DisplayName+" "+item.Provider), query) {
			continue
		}
		filtered = append(filtered, item)
	}
	ranked := routeplan.Rank(profile, filtered)
	if limit <= 0 || limit > 20 {
		limit = 5
	}
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return ranked, nil
}

func (s *Store) chatCandidates() ([]routeplan.Candidate, error) {
	rows, err := s.db.Query(`
SELECT m.id, m.provider_slug, m.display_name, m.reasoning, m.context_window,
       m.input_usd_per_million, m.output_usd_per_million
FROM models m
JOIN providers p ON p.slug = m.provider_slug
WHERE m.active = 1 AND p.enabled = 1
  AND TRIM(p.base_url) != ''
  AND (p.api_key_cipher != '' OR p.key_optional = 1)
  AND (m.kind = '' OR m.kind = ?)
  AND p.protocol IN (?, ?, ?, ?, ?)`,
		catalog.KindChat,
		catalog.ProtocolOpenAIChat, catalog.ProtocolAnthropic, catalog.ProtocolGemini, catalog.ProtocolOllama, catalog.ProtocolCohere)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []routeplan.Candidate
	for rows.Next() {
		var item routeplan.Candidate
		var reasoning int
		if err := rows.Scan(&item.ID, &item.Provider, &item.DisplayName, &reasoning, &item.Context, &item.InputPrice, &item.OutputPrice); err != nil {
			return nil, err
		}
		item.Reasoning = reasoning == 1
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return []routeplan.Candidate{}, nil
	}
	stats, err := s.modelStats()
	if err != nil {
		return nil, err
	}
	for i := range items {
		if stat, ok := stats[items[i].ID]; ok {
			items[i].Requests = stat.requests
			items[i].Errors = stat.errors
			items[i].AvgLatencyMS = stat.latency
		}
	}
	return items, nil
}

type modelStat struct {
	requests int
	errors   int
	latency  int
}

func (s *Store) modelStats() (map[string]modelStat, error) {
	rows, err := s.db.Query(`
SELECT model_id, COUNT(*),
       COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0),
       COALESCE(AVG(CASE WHEN latency_ms > 0 AND status_code < 400 THEN latency_ms END), 0)
FROM request_logs
WHERE model_id != ''
GROUP BY model_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]modelStat{}
	for rows.Next() {
		var id string
		var stat modelStat
		var requests, errors, latency float64
		if err := rows.Scan(&id, &requests, &errors, &latency); err != nil {
			return nil, err
		}
		stat.requests = int(requests)
		stat.errors = int(errors)
		stat.latency = int(latency)
		out[id] = stat
	}
	return out, rows.Err()
}

func (s *Store) requestCounts(ids []string) (map[string]int, error) {
	out := map[string]int{}
	if len(ids) == 0 {
		return out, nil
	}
	stats, err := s.modelStats()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		out[id] = stats[id].requests
	}
	return out, nil
}

func (s *Store) bumpCursor(key string, n int) (int, error) {
	if n <= 1 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var raw sql.NullString
	err = tx.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	start := 0
	if raw.Valid {
		if parsed, err := strconv.Atoi(raw.String); err == nil && parsed > 0 {
			start = parsed
		}
	}
	start %= n
	next := (start + 1) % n
	if _, err := tx.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, strconv.Itoa(next)); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return start, nil
}
