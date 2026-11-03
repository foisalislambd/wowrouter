package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"airoute/server/internal/secret"
)

const (
	strategyFillFirst  = "fill-first"
	strategyRoundRobin = "round-robin"
	maxAccounts        = 20
)

// Account is one saved login for a provider. The secret itself is never returned.
type Account struct {
	ID           string  `json:"id"`
	ProviderSlug string  `json:"providerSlug"`
	Name         string  `json:"name"`
	HasAPIKey    bool    `json:"hasApiKey"`
	APIKeyHint   string  `json:"apiKeyHint"`
	Priority     int     `json:"priority"`
	Enabled      bool    `json:"enabled"`
	LastUsedAt   *string `json:"lastUsedAt"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

// AccountInput updates the fields that are non-nil.
type AccountInput struct {
	Name     *string
	APIKey   *string
	Priority *int
	Enabled  *bool
}

func normalizeStrategy(value string) (string, error) {
	switch strings.TrimSpace(value) {
	case "", strategyFillFirst:
		return strategyFillFirst, nil
	case strategyRoundRobin:
		return strategyRoundRobin, nil
	default:
		return "", errors.New("account strategy must be fill-first or round-robin")
	}
}

func (s *Store) importLegacyAccounts() error {
	rows, err := s.db.Query(`
SELECT slug, api_key_cipher, api_key_hint, updated_at
FROM providers
WHERE api_key_cipher != ''
  AND NOT EXISTS (SELECT 1 FROM provider_accounts a WHERE a.provider_slug = providers.slug)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type legacy struct {
		slug, cipher, hint, updated string
	}
	var pending []legacy
	for rows.Next() {
		var item legacy
		if err := rows.Scan(&item.slug, &item.cipher, &item.hint, &item.updated); err != nil {
			return err
		}
		pending = append(pending, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range pending {
		id, err := newAccountID()
		if err != nil {
			return err
		}
		when := item.updated
		if when == "" {
			when = time.Now().UTC().Format(time.RFC3339)
		}
		if _, err := s.db.Exec(`
INSERT INTO provider_accounts (
  id, provider_slug, name, api_key_cipher, api_key_hint, priority, enabled, created_at, updated_at
) VALUES (?, ?, 'Account 1', ?, ?, 0, 1, ?, ?)`,
			id, item.slug, item.cipher, item.hint, when, when); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListAccounts(slug string) ([]Account, error) {
	if _, err := s.GetProvider(slug); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
SELECT id, provider_slug, name, api_key_cipher, api_key_hint, priority, enabled, last_used_at, created_at, updated_at
FROM provider_accounts WHERE provider_slug = ?
ORDER BY priority, created_at, id`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Account{}
	for rows.Next() {
		item, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) CreateAccount(slug string, input AccountInput) (Account, error) {
	if _, err := s.GetProvider(slug); err != nil {
		return Account{}, err
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM provider_accounts WHERE provider_slug = ?`, slug).Scan(&count); err != nil {
		return Account{}, err
	}
	if count >= maxAccounts {
		return Account{}, errors.New("this provider already has 20 accounts")
	}
	apiKey := ""
	if input.APIKey != nil {
		apiKey = strings.TrimSpace(*input.APIKey)
	}
	if apiKey == "" {
		return Account{}, errors.New("paste an API key for this account")
	}
	name := accountName(input.Name, count+1)
	priority := count
	if input.Priority != nil {
		priority = clampPriority(*input.Priority)
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	sealed, err := secret.Seal(s.key, apiKey)
	if err != nil {
		return Account{}, err
	}
	id, err := newAccountID()
	if err != nil {
		return Account{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`
INSERT INTO provider_accounts (
  id, provider_slug, name, api_key_cipher, api_key_hint, priority, enabled, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, slug, name, sealed, keyHint(apiKey), priority, boolInt(enabled), now, now); err != nil {
		return Account{}, err
	}
	if err := s.mirrorPrimaryAccount(slug); err != nil {
		return Account{}, err
	}
	return s.getAccount(slug, id)
}

func (s *Store) UpdateAccount(slug, id string, input AccountInput) (Account, error) {
	current, err := s.getAccount(slug, id)
	if err != nil {
		return Account{}, err
	}
	name := current.Name
	if input.Name != nil {
		name = accountName(input.Name, 1)
	}
	priority := current.Priority
	if input.Priority != nil {
		priority = clampPriority(*input.Priority)
	}
	enabled := current.Enabled
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	if current.Enabled && !enabled {
		provider, err := s.GetProvider(slug)
		if err != nil {
			return Account{}, err
		}
		var remaining int
		if err := s.db.QueryRow(`
SELECT COUNT(*) FROM provider_accounts
WHERE provider_slug = ? AND id != ? AND enabled = 1 AND api_key_cipher != ''`, slug, id).Scan(&remaining); err != nil {
			return Account{}, err
		}
		if provider.Enabled && remaining == 0 && !provider.KeyOptional {
			return Account{}, errors.New("keep one account on, or turn the provider off first")
		}
	}
	if input.APIKey != nil && strings.TrimSpace(*input.APIKey) != "" {
		sealed, err := secret.Seal(s.key, strings.TrimSpace(*input.APIKey))
		if err != nil {
			return Account{}, err
		}
		_, err = s.db.Exec(`
UPDATE provider_accounts
SET name = ?, priority = ?, enabled = ?, api_key_cipher = ?, api_key_hint = ?, updated_at = ?
WHERE id = ? AND provider_slug = ?`,
			name, priority, boolInt(enabled), sealed, keyHint(strings.TrimSpace(*input.APIKey)),
			time.Now().UTC().Format(time.RFC3339), id, slug)
		if err != nil {
			return Account{}, err
		}
	} else {
		_, err = s.db.Exec(`
UPDATE provider_accounts SET name = ?, priority = ?, enabled = ?, updated_at = ? WHERE id = ? AND provider_slug = ?`,
			name, priority, boolInt(enabled), time.Now().UTC().Format(time.RFC3339), id, slug)
		if err != nil {
			return Account{}, err
		}
	}
	if err := s.mirrorPrimaryAccount(slug); err != nil {
		return Account{}, err
	}
	return s.getAccount(slug, id)
}

func (s *Store) DeleteAccount(slug, id string) error {
	provider, err := s.GetProvider(slug)
	if err != nil {
		return err
	}
	if _, err := s.getAccount(slug, id); err != nil {
		return err
	}
	var remaining int
	if err := s.db.QueryRow(`
SELECT COUNT(*) FROM provider_accounts
WHERE provider_slug = ? AND id != ? AND enabled = 1 AND api_key_cipher != ''`, slug, id).Scan(&remaining); err != nil {
		return err
	}
	if provider.Enabled && remaining == 0 && !provider.KeyOptional {
		return errors.New("keep one account, or turn the provider off first")
	}
	if _, err := s.db.Exec(`DELETE FROM provider_accounts WHERE id = ? AND provider_slug = ?`, id, slug); err != nil {
		return err
	}
	return s.mirrorPrimaryAccount(slug)
}

func (s *Store) AccountSecret(slug, id string) (string, error) {
	var cipher string
	var enabled int
	err := s.db.QueryRow(`
SELECT api_key_cipher, enabled FROM provider_accounts WHERE id = ? AND provider_slug = ?`, id, slug).Scan(&cipher, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return secret.Open(s.key, cipher)
}

func (s *Store) TouchAccount(id string) error {
	if id == "" {
		return nil
	}
	_, err := s.db.Exec(`UPDATE provider_accounts SET last_used_at = ? WHERE id = ?`, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

// ExpandAccounts returns one route per enabled account, in the provider's strategy order.
// A provider with no accounts keeps the single route it already had.
func (s *Store) ExpandAccounts(route Route) ([]Route, error) {
	secrets, err := s.orderedAccountSecrets(route.Model.ProviderSlug)
	if err != nil {
		return nil, err
	}
	if len(secrets) == 0 {
		return []Route{route}, nil
	}
	out := make([]Route, 0, len(secrets))
	for _, item := range secrets {
		next := route
		next.APIKey = item.key
		next.AccountID = item.id
		next.AccountName = item.name
		out = append(out, next)
	}
	return out, nil
}

type accountSecret struct {
	id, name, key string
}

func (s *Store) orderedAccountSecrets(slug string) ([]accountSecret, error) {
	var strategy string
	err := s.db.QueryRow(`SELECT COALESCE(account_strategy, 'fill-first') FROM providers WHERE slug = ?`, slug).Scan(&strategy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	order := `priority ASC, created_at ASC, id ASC`
	if strategy == strategyRoundRobin {
		order = `last_used_at ASC, priority ASC, id ASC`
	}
	rows, err := s.db.Query(`
SELECT id, name, api_key_cipher FROM provider_accounts
WHERE provider_slug = ? AND enabled = 1 AND api_key_cipher != ''
ORDER BY `+order, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []accountSecret
	for rows.Next() {
		var item accountSecret
		var cipher string
		if err := rows.Scan(&item.id, &item.name, &cipher); err != nil {
			return nil, err
		}
		item.key, err = secret.Open(s.key, cipher)
		if err != nil {
			return nil, err
		}
		if item.key == "" {
			continue
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) upsertPrimaryAccount(slug, apiKey string) error {
	var id string
	err := s.db.QueryRow(`
SELECT id FROM provider_accounts WHERE provider_slug = ? ORDER BY priority, created_at, id LIMIT 1`, slug).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		if apiKey == "" {
			return nil
		}
		_, err = s.CreateAccount(slug, AccountInput{APIKey: &apiKey})
		return err
	}
	if err != nil {
		return err
	}
	if apiKey == "" {
		_, err = s.db.Exec(`UPDATE provider_accounts SET api_key_cipher = '', api_key_hint = '', updated_at = ? WHERE id = ?`,
			time.Now().UTC().Format(time.RFC3339), id)
		return err
	}
	sealed, err := secret.Seal(s.key, apiKey)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
UPDATE provider_accounts
SET api_key_cipher = ?, api_key_hint = ?, enabled = 1, updated_at = ?
WHERE id = ?`, sealed, keyHint(apiKey), time.Now().UTC().Format(time.RFC3339), id)
	return err
}

func (s *Store) providerHasKeyBesidesPrimary(slug string) (bool, error) {
	var primary string
	err := s.db.QueryRow(`
SELECT id FROM provider_accounts WHERE provider_slug = ? ORDER BY priority, created_at, id LIMIT 1`, slug).Scan(&primary)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var n int
	err = s.db.QueryRow(`
SELECT COUNT(*) FROM provider_accounts
WHERE provider_slug = ? AND id != ? AND enabled = 1 AND api_key_cipher != ''`, slug, primary).Scan(&n)
	return n > 0, err
}

func (s *Store) providerHasKey(slug string) (bool, error) {
	var n int
	err := s.db.QueryRow(`
SELECT COUNT(*) FROM provider_accounts
WHERE provider_slug = ? AND enabled = 1 AND api_key_cipher != ''`, slug).Scan(&n)
	return n > 0, err
}

func (s *Store) writeProviderSettings(slug, baseURL string, enabled bool, strategy string) error {
	if err := s.mirrorPrimaryAccount(slug); err != nil {
		return err
	}
	_, err := s.db.Exec(`
UPDATE providers SET base_url = ?, enabled = ?, account_strategy = ?, updated_at = ? WHERE slug = ?`,
		baseURL, boolInt(enabled), strategy, time.Now().UTC().Format(time.RFC3339), slug)
	return err
}

// mirrorPrimaryAccount copies the fill-first account onto the provider row so older
// queries that still look at providers.api_key_cipher keep working.
func (s *Store) mirrorPrimaryAccount(slug string) error {
	var cipher, hint string
	err := s.db.QueryRow(`
SELECT api_key_cipher, api_key_hint FROM provider_accounts
WHERE provider_slug = ? AND enabled = 1 AND api_key_cipher != ''
ORDER BY priority, created_at, id LIMIT 1`, slug).Scan(&cipher, &hint)
	if errors.Is(err, sql.ErrNoRows) {
		cipher, hint = "", ""
		err = nil
	}
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE providers SET api_key_cipher = ?, api_key_hint = ? WHERE slug = ?`, cipher, hint, slug)
	return err
}

func (s *Store) getAccount(slug, id string) (Account, error) {
	row := s.db.QueryRow(`
SELECT id, provider_slug, name, api_key_cipher, api_key_hint, priority, enabled, last_used_at, created_at, updated_at
FROM provider_accounts WHERE id = ? AND provider_slug = ?`, id, slug)
	item, err := scanAccount(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	return item, err
}

func scanAccount(row scanner) (Account, error) {
	var item Account
	var cipher string
	var enabled int
	var last sql.NullString
	err := row.Scan(&item.ID, &item.ProviderSlug, &item.Name, &cipher, &item.APIKeyHint, &item.Priority, &enabled, &last, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return Account{}, err
	}
	item.HasAPIKey = cipher != ""
	item.Enabled = enabled == 1
	if last.Valid && last.String != "" {
		item.LastUsedAt = &last.String
	}
	return item, nil
}

func accountName(name *string, n int) string {
	value := ""
	if name != nil {
		value = strings.TrimSpace(*name)
	}
	if value == "" {
		value = "Account " + itoa(n)
	}
	if len(value) > 80 {
		value = value[:80]
	}
	return value
}

func clampPriority(n int) int {
	if n < 0 {
		return 0
	}
	if n > 1000 {
		return 1000
	}
	return n
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func newAccountID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "acct-" + hex.EncodeToString(raw), nil
}
