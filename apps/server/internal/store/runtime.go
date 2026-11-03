package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"strconv"
	"strings"
	"time"

	"airoute/server/internal/assist"
	"airoute/server/internal/quota"
	"airoute/server/internal/routeplan"
	"airoute/server/internal/secret"
)

const (
	settingCompression = "compression"
	settingCache       = "cache_enabled"
	settingCacheTTL    = "cache_ttl_sec"
	settingMemory      = "memory_enabled"
	settingOIDCOn      = "oidc_enabled"
	settingOIDCIssuer  = "oidc_issuer"
	settingOIDCClient  = "oidc_client_id"
	settingOIDCSecret  = "oidc_client_secret"
	defaultShare       = 60
)

// Features is the optional prompt helpers. Every field is off until Settings changes it.
type Features struct {
	Compression string `json:"compression"`
	Cache       bool   `json:"cache"`
	CacheTTL    int    `json:"cacheTtl"`
	Memory      bool   `json:"memory"`
}

// OIDCPublic is the sign-in provider, without the client secret.
type OIDCPublic struct {
	Enabled   bool   `json:"enabled"`
	Issuer    string `json:"issuer"`
	ClientID  string `json:"clientId"`
	HasSecret bool   `json:"hasSecret"`
}

// Memory is a note prepended to chat calls when the memory toggle is on.
type Memory struct {
	ID        string `json:"id"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

// StoredFile is one uploaded batch input.
type StoredFile struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	Purpose   string `json:"purpose"`
	Bytes     int    `json:"bytes"`
	Path      string `json:"-"`
	CreatedAt string `json:"createdAt"`
}

// Batch is a small JSONL job stored locally.
type Batch struct {
	ID            string `json:"id"`
	InputFileID   string `json:"input_file_id"`
	Endpoint      string `json:"endpoint"`
	Status        string `json:"status"`
	OutputFileID  string `json:"output_file_id"`
	ErrorFileID   string `json:"error_file_id"`
	RequestCounts string `json:"request_counts"`
	CreatedAt     string `json:"created_at"`
	CompletedAt   string `json:"completed_at"`
}

// PanelLocked is true when a password or OIDC sign-in is required.
func (s *Store) PanelLocked() (bool, error) {
	on, err := s.PanelAuthEnabled()
	if err != nil || on {
		return on, err
	}
	return s.OIDCEnabled()
}

// Features returns the saved helpers. Missing rows mean off.
func (s *Store) Features() (Features, error) {
	out := Features{Compression: "off", CacheTTL: 300}
	mode, err := s.setting(settingCompression)
	if err != nil {
		return out, err
	}
	if assist.KnownMode(mode) && mode != "" && mode != "off" {
		out.Compression = mode
	}
	cache, err := s.setting(settingCache)
	if err != nil {
		return out, err
	}
	out.Cache = cache == "1"
	ttl, err := s.setting(settingCacheTTL)
	if err != nil {
		return out, err
	}
	if n, err := strconv.Atoi(ttl); err == nil && n >= 30 && n <= 86400 {
		out.CacheTTL = n
	}
	memory, err := s.setting(settingMemory)
	if err != nil {
		return out, err
	}
	out.Memory = memory == "1"
	return out, nil
}

// SaveFeatures stores the helper toggles. Compression is off or light.
func (s *Store) SaveFeatures(in Features) (Features, error) {
	mode := "off"
	if in.Compression != "" && in.Compression != "off" {
		if !assist.KnownMode(in.Compression) {
			return Features{}, errString("compression must be off, light, caveman, dedup, headroom, rtk, terse, or ultra")
		}
		mode = in.Compression
	}
	if err := s.setSetting(settingCompression, mode); err != nil {
		return Features{}, err
	}
	cache := "0"
	if in.Cache {
		cache = "1"
	}
	if err := s.setSetting(settingCache, cache); err != nil {
		return Features{}, err
	}
	ttl := in.CacheTTL
	if ttl == 0 {
		ttl = 300
	}
	if ttl < 30 || ttl > 86400 {
		return Features{}, errString("cache time must be from 30 to 86400 seconds")
	}
	if err := s.setSetting(settingCacheTTL, strconv.Itoa(ttl)); err != nil {
		return Features{}, err
	}
	memory := "0"
	if in.Memory {
		memory = "1"
	}
	if err := s.setSetting(settingMemory, memory); err != nil {
		return Features{}, err
	}
	return s.Features()
}

// OIDCEnabled reports whether the optional SSO lock is on.
func (s *Store) OIDCEnabled() (bool, error) {
	on, err := s.setting(settingOIDCOn)
	return on == "1", err
}

// OIDCPublic returns the issuer and client id.
func (s *Store) OIDCPublic() (OIDCPublic, error) {
	var out OIDCPublic
	var err error
	out.Enabled, err = s.OIDCEnabled()
	if err != nil {
		return out, err
	}
	out.Issuer, err = s.setting(settingOIDCIssuer)
	if err != nil {
		return out, err
	}
	out.ClientID, err = s.setting(settingOIDCClient)
	if err != nil {
		return out, err
	}
	secret, err := s.setting(settingOIDCSecret)
	if err != nil {
		return out, err
	}
	out.HasSecret = secret != ""
	return out, nil
}

// OIDCSecret opens the stored client secret.
func (s *Store) OIDCSecret() (string, error) {
	sealed, err := s.setting(settingOIDCSecret)
	if err != nil || sealed == "" {
		return "", err
	}
	return secret.Open(s.key, sealed)
}

// SaveOIDC turns SSO on or off. An empty secret keeps the saved one.
func (s *Store) SaveOIDC(enabled bool, issuer, clientID, clientSecret string) (OIDCPublic, error) {
	issuer = strings.TrimRight(strings.TrimSpace(issuer), "/")
	clientID = strings.TrimSpace(clientID)
	if enabled {
		if err := validateIssuer(issuer); err != nil {
			return OIDCPublic{}, err
		}
		if clientID == "" {
			return OIDCPublic{}, errString("OIDC needs a client id")
		}
		existing, err := s.setting(settingOIDCSecret)
		if err != nil {
			return OIDCPublic{}, err
		}
		if strings.TrimSpace(clientSecret) == "" && existing == "" {
			return OIDCPublic{}, errString("OIDC needs a client secret")
		}
	}
	if err := s.setSetting(settingOIDCIssuer, issuer); err != nil {
		return OIDCPublic{}, err
	}
	if err := s.setSetting(settingOIDCClient, clientID); err != nil {
		return OIDCPublic{}, err
	}
	if strings.TrimSpace(clientSecret) != "" {
		sealed, err := secret.Seal(s.key, strings.TrimSpace(clientSecret))
		if err != nil {
			return OIDCPublic{}, err
		}
		if err := s.setSetting(settingOIDCSecret, sealed); err != nil {
			return OIDCPublic{}, err
		}
	}
	flag := "0"
	if enabled {
		flag = "1"
	}
	if err := s.setSetting(settingOIDCOn, flag); err != nil {
		return OIDCPublic{}, err
	}
	if !enabled {
		return s.OIDCPublic()
	}
	return s.OIDCPublic()
}

func validateIssuer(issuer string) error {
	if strings.HasPrefix(issuer, "https://") && len(issuer) > len("https://") {
		return nil
	}
	if strings.HasPrefix(issuer, "http://127.0.0.1") || strings.HasPrefix(issuer, "http://localhost") {
		return nil
	}
	return errString("OIDC issuer must be https, or http on localhost")
}

// SaveQuota records a provider limit snapshot for one model.
func (s *Store) SaveQuota(slot string, snap quota.Snapshot) error {
	if slot == "" || !snap.Known {
		return nil
	}
	_, err := s.db.Exec(`
INSERT INTO quota_slots (slot, remaining, limit_n, reset_unix, cooldown_until, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(slot) DO UPDATE SET
  remaining = excluded.remaining,
  limit_n = excluded.limit_n,
  reset_unix = excluded.reset_unix,
  cooldown_until = excluded.cooldown_until,
  updated_at = excluded.updated_at`,
		slot, snap.Remaining, snap.Limit, snap.ResetUnix, snap.CooldownUntil, time.Now().UTC().Format(time.RFC3339))
	return err
}

// AddQuotaHit counts one successful call in the current share bucket.
func (s *Store) AddQuotaHit(slot string, now time.Time) error {
	if slot == "" {
		return nil
	}
	bucket := now.UTC().Truncate(time.Hour).Unix()
	_, err := s.db.Exec(`
INSERT INTO quota_hits (slot, key_id, bucket, hits) VALUES (?, '*', ?, 1)
ON CONFLICT(slot, key_id, bucket) DO UPDATE SET hits = hits + 1`, slot, bucket)
	return err
}

// QuotaWindows loads what we know. Unknown slots stay at Remaining -1.
func (s *Store) QuotaWindows(ids []string, now time.Time) ([]routeplan.Window, error) {
	keys, err := s.countKeys()
	if err != nil {
		return nil, err
	}
	if keys < 1 {
		keys = 1
	}
	out := make([]routeplan.Window, len(ids))
	for i, id := range ids {
		window := routeplan.Window{Remaining: -1, Share: defaultShare}
		var remaining, limit int
		var reset, cooldown int64
		err := s.db.QueryRow(`SELECT remaining, limit_n, reset_unix, cooldown_until FROM quota_slots WHERE slot = ?`, id).
			Scan(&remaining, &limit, &reset, &cooldown)
		if err == nil {
			window.Remaining = remaining
			window.Limit = limit
			window.ResetUnix = reset
			window.CooldownUntil = cooldown
			if remaining >= 0 {
				share := remaining / keys
				if share < 1 {
					share = 1
				}
				window.Share = share
			}
		} else if err != sql.ErrNoRows {
			return nil, err
		}
		bucket := now.UTC().Truncate(time.Hour).Unix()
		if window.ResetUnix > now.Unix() {
			bucket = window.ResetUnix
		}
		var hits int
		err = s.db.QueryRow(`SELECT hits FROM quota_hits WHERE slot = ? AND key_id = '*' AND bucket = ?`, id, bucket).Scan(&hits)
		if err == nil {
			window.Used = hits
		} else if err != sql.ErrNoRows {
			return nil, err
		}
		out[i] = window
	}
	return out, nil
}

func (s *Store) countKeys() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM router_keys`).Scan(&n)
	return n, err
}

// Cached returns a stored completion that has not expired.
func (s *Store) Cached(key string, now time.Time) ([]byte, bool, error) {
	var body, expires string
	err := s.db.QueryRow(`SELECT body, expires_at FROM response_cache WHERE cache_key = ?`, key).Scan(&body, &expires)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	at, err := time.Parse(time.RFC3339, expires)
	if err != nil || !at.After(now) {
		_, _ = s.db.Exec(`DELETE FROM response_cache WHERE cache_key = ?`, key)
		return nil, false, nil
	}
	return []byte(body), true, nil
}

// PutCache stores one non-streaming completion.
func (s *Store) PutCache(key, body string, expires time.Time) error {
	if key == "" || body == "" {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
INSERT INTO response_cache (cache_key, body, created_at, expires_at) VALUES (?, ?, ?, ?)
ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, created_at = excluded.created_at, expires_at = excluded.expires_at`,
		key, body, now, expires.UTC().Format(time.RFC3339))
	return err
}

// ListMemories returns saved notes, newest first.
func (s *Store) ListMemories() ([]Memory, error) {
	rows, err := s.db.Query(`SELECT id, body, created_at FROM memories ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Memory{}
	for rows.Next() {
		var item Memory
		if err := rows.Scan(&item.ID, &item.Body, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// AddMemory stores one note.
func (s *Store) AddMemory(body string) (Memory, error) {
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 4000 {
		return Memory{}, errString("a memory note must be 1 to 4000 characters")
	}
	id, err := newID()
	if err != nil {
		return Memory{}, err
	}
	item := Memory{ID: id, Body: body, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	_, err = s.db.Exec(`INSERT INTO memories (id, body, created_at) VALUES (?, ?, ?)`, item.ID, item.Body, item.CreatedAt)
	return item, err
}

// DeleteMemory removes one note.
func (s *Store) DeleteMemory(id string) error {
	res, err := s.db.Exec(`DELETE FROM memories WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// MemoryText joins notes for the system message. The result is capped.
func (s *Store) MemoryText() (string, error) {
	items, err := s.ListMemories()
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for i := len(items) - 1; i >= 0; i-- {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(items[i].Body)
		if b.Len() > 8000 {
			break
		}
	}
	text := b.String()
	if len(text) > 8000 {
		text = text[:8000]
	}
	return text, nil
}

// InsertFile records a file that already exists on disk.
func (s *Store) InsertFile(filename, purpose, path string, size int) (StoredFile, error) {
	id, err := newID()
	if err != nil {
		return StoredFile{}, err
	}
	item := StoredFile{
		ID: "file_" + id, Filename: filename, Purpose: purpose, Bytes: size, Path: path,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_, err = s.db.Exec(`INSERT INTO stored_files (id, filename, purpose, bytes, path, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		item.ID, item.Filename, item.Purpose, item.Bytes, item.Path, item.CreatedAt)
	return item, err
}

// GetFile loads one file record.
func (s *Store) GetFile(id string) (StoredFile, error) {
	var item StoredFile
	err := s.db.QueryRow(`SELECT id, filename, purpose, bytes, path, created_at FROM stored_files WHERE id = ?`, id).
		Scan(&item.ID, &item.Filename, &item.Purpose, &item.Bytes, &item.Path, &item.CreatedAt)
	if err == sql.ErrNoRows {
		return StoredFile{}, ErrNotFound
	}
	return item, err
}

// ListFiles returns uploaded files, newest first.
func (s *Store) ListFiles() ([]StoredFile, error) {
	rows, err := s.db.Query(`SELECT id, filename, purpose, bytes, path, created_at FROM stored_files ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StoredFile{}
	for rows.Next() {
		var item StoredFile
		if err := rows.Scan(&item.ID, &item.Filename, &item.Purpose, &item.Bytes, &item.Path, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// DeleteFile removes the row and returns the path to unlink.
func (s *Store) DeleteFile(id string) (string, error) {
	item, err := s.GetFile(id)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(`DELETE FROM stored_files WHERE id = ?`, id)
	return item.Path, err
}

// CreateBatch inserts a job in the in_progress state.
func (s *Store) CreateBatch(inputID, endpoint string) (Batch, error) {
	id, err := newID()
	if err != nil {
		return Batch{}, err
	}
	item := Batch{
		ID: "batch_" + id, InputFileID: inputID, Endpoint: endpoint, Status: "in_progress",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_, err = s.db.Exec(`INSERT INTO batches (id, input_file_id, endpoint, status, created_at) VALUES (?, ?, ?, ?, ?)`,
		item.ID, item.InputFileID, item.Endpoint, item.Status, item.CreatedAt)
	return item, err
}

// FinishBatch stores the output files and final counts.
func (s *Store) FinishBatch(id, status, outputID, errorID, counts string) error {
	_, err := s.db.Exec(`UPDATE batches SET status = ?, output_file_id = ?, error_file_id = ?, request_counts = ?, completed_at = ? WHERE id = ?`,
		status, outputID, errorID, counts, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

// GetBatch loads one job.
func (s *Store) GetBatch(id string) (Batch, error) {
	var item Batch
	err := s.db.QueryRow(`SELECT id, input_file_id, endpoint, status, output_file_id, error_file_id, request_counts, created_at, completed_at FROM batches WHERE id = ?`, id).
		Scan(&item.ID, &item.InputFileID, &item.Endpoint, &item.Status, &item.OutputFileID, &item.ErrorFileID, &item.RequestCounts, &item.CreatedAt, &item.CompletedAt)
	if err == sql.ErrNoRows {
		return Batch{}, ErrNotFound
	}
	return item, err
}

func newID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}
