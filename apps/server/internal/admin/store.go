package admin

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"wowrouter/server/internal/gateway"
	"wowrouter/server/internal/notify"
	"wowrouter/server/internal/oauth"
	"wowrouter/server/internal/secret"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")
var ErrPrecondition = errors.New("precondition failed")

type Resource struct {
	Name       string
	Spec       map[string]any
	Private    map[string]any
	ETag       string
	Generation int64
	CreatedAt  string
	UpdatedAt  string
	ManagedBy  string
	Once       string
}

type Store struct {
	mu          sync.Mutex
	gen         int64
	snap        *snapshot
	logs        chan logItem
	logDone     chan struct{}
	cacheMu     sync.Mutex
	cacheExact  map[string]string
	cacheLoaded bool
	seal        []byte
	oauthMu     sync.Mutex
	driver      string
	db          sqlDB
}

type snapshot struct {
	gen    int64
	cols   map[string]map[string]Resource
	hashes map[string]string
}

type logItem struct {
	rec   map[string]any
	cache *cacheWrite
	flush chan struct{}
}

type cacheWrite struct {
	key, model, prompt, response, vector string
	exact                                bool
}

func Open(path string) (*Store, string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, "", err
	}
	dsn, err := sqliteDSN(path)
	if err != nil {
		return nil, "", err
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, "", err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, driver: "sqlite"}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, "", err
	}
	token, err := s.ensureBootstrap(filepath.Dir(path))
	if err != nil {
		db.Close()
		return nil, "", err
	}
	if err := s.ensureTenancy(); err != nil {
		db.Close()
		return nil, "", err
	}
	s.cacheExact = map[string]string{}
	s.loadCache()
	s.logs = make(chan logItem, 256)
	s.logDone = make(chan struct{})
	go s.logger()
	return s, token, nil
}

// UseSeal encrypts the private column with the local AES-GCM key.
// Existing plaintext rows are rewritten once. A nil key leaves rows readable.
func (s *Store) UseSeal(key []byte) error {
	if len(key) != 32 {
		return fmt.Errorf("secret key must be 32 bytes")
	}
	s.mu.Lock()
	s.seal = append([]byte(nil), key...)
	s.snap = nil
	s.mu.Unlock()
	rows, err := s.db.Query(`SELECT collection, name, private FROM resources`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct{ collection, name, private string }
	var pending []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.collection, &item.name, &item.private); err != nil {
			return err
		}
		if strings.HasPrefix(item.private, "enc1:") {
			continue
		}
		pending = append(pending, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range pending {
		sealed, err := secret.Seal(key, item.private)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`UPDATE resources SET private = ? WHERE collection = ? AND name = ?`, "enc1:"+sealed, item.collection, item.name); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.snap = nil
	s.mu.Unlock()
	return nil
}

func (s *Store) openPrivate(raw string) string {
	if !strings.HasPrefix(raw, "enc1:") {
		return raw
	}
	if len(s.seal) != 32 {
		return "{}"
	}
	plain, err := secret.Open(s.seal, strings.TrimPrefix(raw, "enc1:"))
	if err != nil {
		return "{}"
	}
	return plain
}

func (s *Store) sealPrivate(plain string) (string, error) {
	if len(s.seal) != 32 {
		return plain, nil
	}
	sealed, err := secret.Seal(s.seal, plain)
	if err != nil {
		return "", err
	}
	return "enc1:" + sealed, nil
}

func (s *Store) Close() error {
	if s.logs != nil {
		close(s.logs)
		<-s.logDone
		s.logs = nil
	}
	return s.db.Close()
}

func sqliteDSN(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	u := url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(abs)}
	return u.String() + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=cache_size(-2000)", nil
}

func (s *Store) migrate() error {
	err := s.execScript(`
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resources (
  collection TEXT NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  private TEXT NOT NULL,
  etag TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  managed_by TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (collection, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  principal TEXT NOT NULL DEFAULT 'bootstrap',
  role TEXT NOT NULL DEFAULT 'admin'
);
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  key_name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  status_code INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_logs_started ON request_logs(started_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spend (
  bucket TEXT PRIMARY KEY,
  usd REAL NOT NULL,
  tokens INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_windows (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  exact INTEGER NOT NULL,
  vector TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS key_cooldowns (
  provider TEXT NOT NULL,
  key_id TEXT NOT NULL,
  until_unix INTEGER NOT NULL,
  PRIMARY KEY (provider, key_id)
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  status INTEGER NOT NULL,
  expires_unix INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prefs (
  principal TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`)
	if err != nil {
		return err
	}
	_, _ = s.db.Exec(`ALTER TABLE sessions ADD COLUMN principal TEXT NOT NULL DEFAULT 'bootstrap'`)
	_, _ = s.db.Exec(`ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`)
	var gen int64
	_ = s.db.QueryRow(`SELECT v FROM meta WHERE k = 'generation'`).Scan(&gen)
	s.gen = gen
	return nil
}

func (s *Store) ensureBootstrap(dir string) (string, error) {
	path := filepath.Join(dir, "bootstrap-token")
	if raw, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(raw))) > 0 {
		return "", nil
	}
	token, err := randomToken("ak-wowrouter-", 24)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(token+"\n"), 0o600); err != nil {
		return "", err
	}
	if err := s.setMeta("bootstrap_hash", shaHex(token)); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Store) BootstrapMatches(token string) bool {
	hash, err := s.meta("bootstrap_hash")
	if err != nil || hash == "" || token == "" {
		return false
	}
	return hashEqual(hash, shaHex(strings.TrimSpace(token)))
}

func hashEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func (s *Store) ensureTenancy() error {
	if _, err := s.Get("organizations", "default"); errors.Is(err, ErrNotFound) {
		if _, err := s.Put("organizations", "default", map[string]any{"display_name": "Default", "enabled": true}, "", false); err != nil {
			return err
		}
	}
	if _, err := s.Get("teams", "default"); errors.Is(err, ErrNotFound) {
		if _, err := s.Put("teams", "default", map[string]any{"organization": "default", "display_name": "Default", "enabled": true}, "", false); err != nil {
			return err
		}
	}
	if _, err := s.Get("projects", "default"); errors.Is(err, ErrNotFound) {
		if _, err := s.Put("projects", "default", map[string]any{"organization": "default", "team": "default", "display_name": "Default", "enabled": true}, "", false); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) meta(k string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT v FROM meta WHERE k = ?`, k).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (s *Store) setMeta(k, v string) error {
	_, err := s.db.Exec(`INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, v)
	return err
}

func (s *Store) Generation() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.gen
}

func (s *Store) bump() (int64, error) {
	s.gen++
	if err := s.setMeta("generation", fmt.Sprintf("%d", s.gen)); err != nil {
		return 0, err
	}
	return s.gen, nil
}

func (s *Store) List(collection string) ([]Resource, error) {
	rows, err := s.db.Query(`SELECT name, spec, private, etag, generation, created_at, updated_at, managed_by FROM resources WHERE collection = ? ORDER BY name`, collection)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Resource
	for rows.Next() {
		res, err := s.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, res)
	}
	return out, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func (s *Store) scan(sc scanner) (Resource, error) {
	var res Resource
	var spec, private string
	if err := sc.Scan(&res.Name, &spec, &private, &res.ETag, &res.Generation, &res.CreatedAt, &res.UpdatedAt, &res.ManagedBy); err != nil {
		return res, err
	}
	res.Spec = map[string]any{}
	res.Private = map[string]any{}
	_ = json.Unmarshal([]byte(spec), &res.Spec)
	_ = json.Unmarshal([]byte(s.openPrivate(private)), &res.Private)
	if res.Spec == nil {
		res.Spec = map[string]any{}
	}
	if res.Private == nil {
		res.Private = map[string]any{}
	}
	return res, nil
}

func (s *Store) Get(collection, name string) (Resource, error) {
	row := s.db.QueryRow(`SELECT name, spec, private, etag, generation, created_at, updated_at, managed_by FROM resources WHERE collection = ? AND name = ?`, collection, name)
	res, err := s.scan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Resource{}, ErrNotFound
	}
	return res, err
}

func (s *Store) Put(collection, name string, spec map[string]any, ifMatch string, merge bool) (Resource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev, err := s.Get(collection, name)
	exists := err == nil
	if err != nil && !errors.Is(err, ErrNotFound) {
		return Resource{}, err
	}
	if ifMatch != "" && (!exists || prev.ETag != ifMatch) {
		return Resource{}, ErrPrecondition
	}
	full := cloneMap(spec)
	if exists {
		fullAny := keepSecrets(prev.Private, full)
		full, _ = fullAny.(map[string]any)
		if merge {
			full = mergePatch(prev.Private, full)
		}
	}
	if collection == "keys" {
		if err := s.prepareKey(name, full, &prev, exists); err != nil {
			return Resource{}, err
		}
	}
	once := asString(full["secret_once"])
	delete(full, "secret_once")
	if collection == "settings" && name == "auth" && localEnabled(full) && strings.TrimSpace(asString(full["password_hash"])) == "" {
		return Resource{}, errPasswordRequired
	}
	publicAny, _ := redactTree(full).(map[string]any)
	gen, err := s.bump()
	if err != nil {
		return Resource{}, err
	}
	etag := fmt.Sprintf(`"g%d"`, gen)
	created := nowRFC()
	if exists {
		created = prev.CreatedAt
	}
	if publicAny != nil {
		delete(publicAny, "secret_sha256")
	}
	pub, _ := json.Marshal(publicAny)
	privJSON, _ := json.Marshal(full)
	priv, err := s.sealPrivate(string(privJSON))
	if err != nil {
		return Resource{}, err
	}
	_, err = s.db.Exec(`INSERT INTO resources(collection, name, spec, private, etag, generation, created_at, updated_at, managed_by)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'api')
		ON CONFLICT(collection, name) DO UPDATE SET spec = excluded.spec, private = excluded.private, etag = excluded.etag, generation = excluded.generation, updated_at = excluded.updated_at`,
		collection, name, string(pub), string(priv), etag, gen, created, nowRFC())
	if err != nil {
		return Resource{}, err
	}
	got, err := s.Get(collection, name)
	if err != nil {
		return got, err
	}
	got.Once = once
	return got, nil
}

func (s *Store) prepareKey(name string, full map[string]any, prev *Resource, exists bool) error {
	secret := asString(full["secret"])
	if (secret == "" || secret == "[REDACTED]") && asString(full["secret_sha256"]) != "" && !exists {
		delete(full, "secret")
		return nil
	}
	if secret == "" || secret == "[REDACTED]" {
		if exists && asString(prev.Private["secret_sha256"]) != "" {
			delete(full, "secret")
			full["secret_sha256"] = prev.Private["secret_sha256"]
			full["secret_hint"] = prev.Private["secret_hint"]
			return nil
		}
		var err error
		secret, err = randomToken("sk-wowrouter-", 24)
		if err != nil {
			return err
		}
		full["secret_once"] = secret
	}
	full["secret_sha256"] = shaHex(secret)
	if len(secret) >= 4 {
		full["secret_hint"] = secret[len(secret)-4:]
	}
	delete(full, "secret")
	return nil
}

func (s *Store) Delete(collection, name, ifMatch string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev, err := s.Get(collection, name)
	if err != nil {
		return err
	}
	if ifMatch != "" && prev.ETag != ifMatch {
		return ErrPrecondition
	}
	if _, err := s.bump(); err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM resources WHERE collection = ? AND name = ?`, collection, name)
	return err
}

func (s *Store) Resource(collection, name string) (map[string]any, map[string]any, bool) {
	view := s.view()
	res, ok := view.cols[collection][name]
	if !ok {
		return nil, nil, false
	}
	return res.Spec, res.Private, true
}

func (s *Store) Resources(collection string) []gateway.Named {
	view := s.view()
	col := view.cols[collection]
	out := make([]gateway.Named, 0, len(col))
	for _, res := range col {
		out = append(out, gateway.Named{Name: res.Name, Spec: res.Spec, Private: res.Private})
	}
	return out
}

func (s *Store) AuthenticateKey(token string) (Resource, bool) {
	token = strings.TrimSpace(token)
	if token == "" || !strings.HasPrefix(token, "sk-wowrouter-") {
		return Resource{}, false
	}
	hash := shaHex(token)
	view := s.view()
	name, ok := view.hashes[hash]
	if !ok {
		return Resource{}, false
	}
	key, ok := view.cols["keys"][name]
	if !ok || key.Private["enabled"] == false || key.Spec["enabled"] == false {
		return Resource{}, false
	}
	return key, true
}

func (s *Store) CreateSession() (string, error) {
	raw, err := randomToken("", 32)
	if err != nil {
		return "", err
	}
	exp := time.Now().Add(12 * time.Hour).UTC().Format(time.RFC3339)
	_, err = s.db.Exec(`INSERT INTO sessions(id, hash, expires_at, principal, role) VALUES(?, ?, ?, ?, ?)`, shaHex(raw)[:16], shaHex(raw), exp, "bootstrap", "admin")
	return raw, err
}

// CreateSessionFor starts a session for a console user.
func (s *Store) CreateSessionFor(principal, role string) (string, error) {
	if principal == "" {
		principal = "bootstrap"
	}
	if role == "" {
		role = "admin"
	}
	raw, err := randomToken("", 32)
	if err != nil {
		return "", err
	}
	exp := time.Now().Add(12 * time.Hour).UTC().Format(time.RFC3339)
	_, err = s.db.Exec(`INSERT INTO sessions(id, hash, expires_at, principal, role) VALUES(?, ?, ?, ?, ?)`, shaHex(raw)[:16], shaHex(raw), exp, principal, role)
	return raw, err
}

// SessionRole returns the signed-in principal. Missing role columns still count as an admin session.
func (s *Store) SessionRole(raw string) (principal, role string, ok bool) {
	if raw == "" {
		return "", "", false
	}
	var exp, who, got string
	err := s.db.QueryRow(`SELECT expires_at, principal, role FROM sessions WHERE hash = ?`, shaHex(raw)).Scan(&exp, &who, &got)
	if err != nil {
		return "", "", false
	}
	t, err := time.Parse(time.RFC3339, exp)
	if err != nil || !t.After(time.Now()) {
		return "", "", false
	}
	if got == "" {
		got = "admin"
	}
	if who == "" {
		who = "bootstrap"
	}
	return who, got, true
}

func (s *Store) SessionOK(raw string) bool {
	if raw == "" {
		return false
	}
	var exp string
	err := s.db.QueryRow(`SELECT expires_at FROM sessions WHERE hash = ?`, shaHex(raw)).Scan(&exp)
	if err != nil {
		return false
	}
	t, err := time.Parse(time.RFC3339, exp)
	return err == nil && t.After(time.Now())
}

func (s *Store) DeleteSession(raw string) {
	if raw == "" {
		return
	}
	_, _ = s.db.Exec(`DELETE FROM sessions WHERE hash = ?`, shaHex(raw))
}

func (s *Store) AddAudit(entry map[string]any) {
	id, _ := randomToken("aud_", 8)
	entry["id"] = id
	if _, ok := entry["at"]; !ok {
		entry["at"] = nowRFC()
	}
	normalizeAudit(entry)
	raw, _ := json.Marshal(entry)
	_, _ = s.db.Exec(`INSERT INTO audit_log(id, at, payload) VALUES(?, ?, ?)`, id, asString(entry["at"]), string(raw))
}

func (s *Store) ListAudit(limit int) []map[string]any {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(`SELECT payload FROM audit_log ORDER BY at DESC LIMIT ?`, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(payload), &m) == nil {
			normalizeAudit(m)
			out = append(out, m)
		}
	}
	if out == nil {
		return []map[string]any{}
	}
	return out
}

func (s *Store) AddLog(rec map[string]any) {
	if s.logs == nil {
		s.writeLog(rec)
		return
	}
	select {
	case s.logs <- logItem{rec: rec}:
	default:
	}
}

func (s *Store) FlushLogs() {
	if s.logs == nil {
		return
	}
	done := make(chan struct{})
	s.logs <- logItem{flush: done}
	<-done
}

func (s *Store) ClearLogs() {
	s.FlushLogs()
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = s.db.Exec(`DELETE FROM request_logs`)
}

func (s *Store) Logs(from, to string, limit int) []map[string]any {
	s.FlushLogs()
	if limit <= 0 {
		limit = 100
	}
	if limit > 5000 {
		limit = 5000
	}
	q := `SELECT payload FROM request_logs WHERE 1=1`
	args := []any{}
	if from != "" {
		q += ` AND started_at >= ?`
		args = append(args, from)
	}
	if to != "" {
		q += ` AND started_at < ?`
		args = append(args, to)
	}
	q += ` ORDER BY started_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var payload string
		if rows.Scan(&payload) != nil {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(payload), &m) == nil {
			normalizeLog(m)
			out = append(out, m)
		}
	}
	if out == nil {
		return []map[string]any{}
	}
	return out
}

func (s *Store) LogByID(id string) (map[string]any, bool) {
	var payload string
	err := s.db.QueryRow(`SELECT payload FROM request_logs WHERE id = ?`, id).Scan(&payload)
	if err != nil {
		return nil, false
	}
	var m map[string]any
	if json.Unmarshal([]byte(payload), &m) != nil {
		return nil, false
	}
	normalizeLog(m)
	return m, true
}

// normalizeLog fills the arrays and objects the console reads on every row. A partial record
// (an older write, or a hand-seeded sample) otherwise throws while the table renders and the
// page goes blank.
func normalizeLog(m map[string]any) {
	for _, key := range []string{
		"tags", "attempts", "guardrails", "finish_reasons", "skipped_candidates",
		"translation_warnings", "degraded", "extensions",
	} {
		if asSlice(m[key]) == nil {
			m[key] = []any{}
		}
	}
	for _, key := range []string{"usage", "timing", "cache", "metadata", "cost", "params_applied"} {
		if asMap(m[key]) == nil {
			m[key] = map[string]any{}
		}
	}
	if _, ok := m["stream"]; !ok {
		m["stream"] = nil
	}
	cost := asMap(m["cost"])
	if cost["total"] == nil && cost["usd"] != nil {
		cost["total"] = cost["usd"]
	}
}

// normalizeAudit fills the actor and timestamp the activity list reads. Entries written before
// those fields existed would otherwise crash the key detail.
func normalizeAudit(m map[string]any) {
	if asMap(m["actor"]) == nil {
		m["actor"] = map[string]any{"type": "token", "id": "bootstrap"}
	}
	if asString(m["time"]) == "" {
		if at := asString(m["at"]); at != "" {
			m["time"] = at
		}
	}
	if asString(m["outcome"]) == "" {
		m["outcome"] = "success"
	}
	action := asString(m["action"])
	resource := asString(m["resource"])
	if action != "" && !strings.Contains(action, ".") && !strings.Contains(action, " ") && resource != "" {
		kind := strings.Split(resource, "/")[0]
		m["action"] = kind + "." + action
	}
}

func (s *Store) AddSpend(bucket string, usd float64, tokens int) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	var cur float64
	_ = s.db.QueryRow(`SELECT usd FROM spend WHERE bucket = ?`, bucket).Scan(&cur)
	cur += usd
	_, _ = s.db.Exec(`INSERT INTO spend(bucket, usd, tokens) VALUES(?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET usd = usd + excluded.usd, tokens = tokens + excluded.tokens`, bucket, usd, tokens)
	return cur
}

func (s *Store) SpendOf(bucket string) float64 {
	var cur float64
	_ = s.db.QueryRow(`SELECT usd FROM spend WHERE bucket = ?`, bucket).Scan(&cur)
	return cur
}

func (s *Store) AllowRate(bucket string, limit int, window time.Duration) bool {
	if limit <= 0 {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	windowSec := int64(window / time.Second)
	if windowSec < 1 {
		windowSec = 1
	}
	start := time.Now().Unix() / windowSec
	var stored int64
	var count int
	err := s.db.QueryRow(`SELECT window_start, count FROM rate_windows WHERE bucket = ?`, bucket).Scan(&stored, &count)
	if err != nil || stored != start {
		_, _ = s.db.Exec(`INSERT INTO rate_windows(bucket, window_start, count) VALUES(?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, count = 1`, bucket, start)
		return true
	}
	if count >= limit {
		return false
	}
	_, _ = s.db.Exec(`UPDATE rate_windows SET count = count + 1 WHERE bucket = ?`, bucket)
	return true
}

func (s *Store) CacheGet(key string) (string, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if !s.cacheLoaded {
		s.loadCacheLocked()
	}
	response, ok := s.cacheExact[key]
	return response, ok
}

func (s *Store) CachePut(key, model, prompt, response, vector string, exact bool) {
	if exact {
		s.cacheMu.Lock()
		if s.cacheExact == nil {
			s.cacheExact = map[string]string{}
		}
		s.cacheExact[key] = response
		s.cacheLoaded = true
		s.cacheMu.Unlock()
	}
	if s.logs == nil {
		s.writeCache(cacheWrite{key, model, prompt, response, vector, exact})
		return
	}
	select {
	case s.logs <- logItem{cache: &cacheWrite{key, model, prompt, response, vector, exact}}:
	default:
	}
}

func (s *Store) CacheSemantic(model, prompt string, threshold float64) (string, float64, bool) {
	rows, err := s.db.Query(`SELECT key, vector, response FROM cache_entries WHERE model = ? AND exact = 0`, model)
	if err != nil {
		return "", 0, false
	}
	defer rows.Close()
	best := 0.0
	var response, key string
	for rows.Next() {
		var k, vector, resp string
		if rows.Scan(&k, &vector, &resp) != nil {
			continue
		}
		score := cosineJSON(prompt, vector)
		if score > best {
			best = score
			response = resp
			key = k
		}
	}
	if best >= threshold && response != "" {
		_, _ = s.db.Exec(`UPDATE cache_entries SET hits = hits + 1 WHERE key = ?`, key)
		return response, best, true
	}
	return "", best, false
}

func cosineJSON(prompt, vector string) float64 {
	a := bow(prompt)
	var b map[string]float64
	if json.Unmarshal([]byte(vector), &b) != nil || len(a) == 0 || len(b) == 0 {
		return 0
	}
	var dot, na, nb float64
	for k, av := range a {
		na += av * av
		if bv, ok := b[k]; ok {
			dot += av * bv
		}
	}
	for _, bv := range b {
		nb += bv * bv
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (sqrt(na) * sqrt(nb))
}

func bow(text string) map[string]float64 {
	out := map[string]float64{}
	for _, w := range strings.Fields(strings.ToLower(text)) {
		w = strings.Trim(w, ".,!?;:\"'()[]{}")
		if len(w) < 2 {
			continue
		}
		out[w]++
	}
	return out
}

func sqrt(v float64) float64 {
	if v <= 0 {
		return 0
	}
	g := v
	for i := 0; i < 12; i++ {
		g = (g + v/g) / 2
	}
	return g
}

func (s *Store) CacheStats() (entries int, hits int) {
	_ = s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(hits), 0) FROM cache_entries`).Scan(&entries, &hits)
	return entries, hits
}

func (s *Store) PutAlert(a map[string]any) {
	id := asString(a["id"])
	if id == "" {
		id, _ = randomToken("al_", 6)
		a["id"] = id
	}
	raw, _ := json.Marshal(a)
	_, _ = s.db.Exec(`INSERT INTO alerts(id, payload) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, id, string(raw))
	go s.deliverAlert(a)
}

// SaveOAuth stores a subscription token on a provider and uses it as that provider's key.
func (s *Store) SaveOAuth(provider, access, refresh string, exp time.Time) error {
	spec := map[string]any{}
	if res, err := s.Get("providers", provider); err == nil {
		spec = cloneMap(res.Private)
		if len(spec) == 0 {
			spec = cloneMap(res.Spec)
		}
	}
	if spec == nil {
		spec = map[string]any{}
	}
	spec["oauth"] = map[string]any{
		"access_token": access, "refresh_token": refresh, "expires_at": exp.UTC().Format(time.RFC3339),
	}
	auth := asMap(spec["auth"])
	if auth == nil {
		auth = map[string]any{}
	}
	auth["api_key"] = access
	spec["auth"] = auth
	if spec["enabled"] == nil {
		spec["enabled"] = true
	}
	_, err := s.Put("providers", provider, spec, "", true)
	return err
}

// EnsureFreshToken refreshes a subscription token that is missing or due within a minute.
// The new access token is stored as the provider key. A provider with no refresh token is left alone.
func (s *Store) EnsureFreshToken(provider string) (string, bool) {
	if s == nil || provider == "" {
		return "", false
	}
	s.oauthMu.Lock()
	defer s.oauthMu.Unlock()
	res, err := s.Get("providers", provider)
	if err != nil {
		return "", false
	}
	row := asMap(res.Private["oauth"])
	refresh := asString(row["refresh_token"])
	if refresh == "" {
		return "", false
	}
	if exp, err := time.Parse(time.RFC3339, asString(row["expires_at"])); err == nil && time.Until(exp) > time.Minute {
		return "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, err := oauth.Refresh(ctx, provider, refresh, nil)
	if err != nil || result.AccessToken == "" {
		return "", false
	}
	if result.RefreshToken == "" {
		result.RefreshToken = refresh
	}
	if result.ExpiresAt.IsZero() {
		result.ExpiresAt = time.Now().Add(time.Hour)
	}
	if err := s.SaveOAuth(provider, result.AccessToken, result.RefreshToken, result.ExpiresAt); err != nil {
		return "", false
	}
	return result.AccessToken, true
}

// Cooldown is one persisted credential pause.
type Cooldown struct {
	Provider string
	KeyID    string
	Until    int64
}

// SaveKeyCooldown records a credential pause so a restart still skips it.
func (s *Store) SaveKeyCooldown(provider, keyID string, until time.Time) {
	if s == nil || provider == "" || keyID == "" || until.IsZero() {
		return
	}
	_, _ = s.db.Exec(`INSERT INTO key_cooldowns(provider, key_id, until_unix) VALUES(?, ?, ?)
		ON CONFLICT(provider, key_id) DO UPDATE SET until_unix = excluded.until_unix`, provider, keyID, until.Unix())
}

// KeyCooldowns returns pauses that have not expired yet.
func (s *Store) KeyCooldowns() []Cooldown {
	if s == nil {
		return nil
	}
	now := time.Now().Unix()
	_, _ = s.db.Exec(`DELETE FROM key_cooldowns WHERE until_unix <= ?`, now)
	rows, err := s.db.Query(`SELECT provider, key_id, until_unix FROM key_cooldowns WHERE until_unix > ?`, now)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Cooldown
	for rows.Next() {
		var item Cooldown
		if rows.Scan(&item.Provider, &item.KeyID, &item.Until) != nil {
			continue
		}
		out = append(out, item)
	}
	return out
}

// Idempotent returns a stored response for a client retry key.
func (s *Store) Idempotent(key string) (int, []byte, bool) {
	if s == nil || key == "" {
		return 0, nil, false
	}
	var status int
	var body string
	var exp int64
	err := s.db.QueryRow(`SELECT status, body, expires_unix FROM idempotency WHERE key = ?`, key).Scan(&status, &body, &exp)
	if err != nil || time.Now().Unix() > exp {
		return 0, nil, false
	}
	return status, []byte(body), true
}

// SaveIdempotent keeps a successful response for five minutes. Bodies over 1 MiB are skipped.
func (s *Store) SaveIdempotent(key string, status int, body []byte) {
	if s == nil || key == "" || status >= 500 || len(body) == 0 || len(body) > 1<<20 {
		return
	}
	_, _ = s.db.Exec(`INSERT INTO idempotency(key, body, status, expires_unix) VALUES(?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET body = excluded.body, status = excluded.status, expires_unix = excluded.expires_unix`,
		key, string(body), status, time.Now().Add(5*time.Minute).Unix())
}

func (s *Store) deliverAlert(a map[string]any) {
	channels, err := s.List("alerts/channels")
	if err != nil {
		return
	}
	msg := notify.Message{
		ID: asString(a["id"]), Title: asString(a["title"]), Body: asString(a["message"]),
		Severity: asString(a["severity"]), At: asString(a["at"]),
	}
	if msg.Title == "" {
		msg.Title = "WowRouter alert"
	}
	for _, ch := range channels {
		if ch.Spec["enabled"] == false {
			continue
		}
		url := asString(ch.Private["url"])
		if url == "" {
			url = asString(ch.Spec["url"])
		}
		if err := gateway.SafeHTTPURL(url); err != nil {
			continue
		}
		secret := asString(ch.Private["signing_secret"])
		if secret == "" {
			secret = asString(ch.Private["secret"])
		}
		_ = notify.Post(nil, notify.Channel{Name: ch.Name, URL: url, Secret: secret}, msg)
	}
}

func (s *Store) Alerts() []map[string]any {
	rows, err := s.db.Query(`SELECT payload FROM alerts`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var payload string
		if rows.Scan(&payload) != nil {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(payload), &m) == nil {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return asString(out[i]["fired_at"]) > asString(out[j]["fired_at"]) })
	if out == nil {
		return []map[string]any{}
	}
	return out
}

func (s *Store) Preferences(principal string) map[string]any {
	var payload string
	if s.db.QueryRow(`SELECT payload FROM prefs WHERE principal = ?`, principal).Scan(&payload) != nil {
		return map[string]any{}
	}
	var m map[string]any
	if json.Unmarshal([]byte(payload), &m) != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func (s *Store) SetPreferences(principal string, prefs map[string]any) {
	raw, _ := json.Marshal(prefs)
	_, _ = s.db.Exec(`INSERT INTO prefs(principal, payload) VALUES(?, ?) ON CONFLICT(principal) DO UPDATE SET payload = excluded.payload`, principal, string(raw))
}

func (s *Store) ConfigDocument() map[string]any {
	doc := map[string]any{"version": 1}
	for _, col := range []string{"providers", "deployments", "models", "routes", "organizations", "teams", "projects", "keys", "users", "guardrails", "plugins"} {
		list, err := s.List(col)
		if err != nil {
			continue
		}
		bucket := map[string]any{}
		for _, res := range list {
			spec := cloneMap(res.Spec)
			delete(spec, "secret_sha256")
			bucket[res.Name] = spec
		}
		doc[col] = bucket
	}
	return doc
}

func (s *Store) view() *snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snap != nil && s.snap.gen == s.gen {
		return s.snap
	}
	snap := &snapshot{gen: s.gen, cols: map[string]map[string]Resource{}, hashes: map[string]string{}}
	rows, err := s.db.Query(`SELECT collection, name, spec, private, etag, generation, created_at, updated_at, managed_by FROM resources`)
	if err != nil {
		s.snap = snap
		return snap
	}
	defer rows.Close()
	for rows.Next() {
		var collection string
		var res Resource
		var spec, private string
		if err := rows.Scan(&collection, &res.Name, &spec, &private, &res.ETag, &res.Generation, &res.CreatedAt, &res.UpdatedAt, &res.ManagedBy); err != nil {
			continue
		}
		res.Spec = map[string]any{}
		res.Private = map[string]any{}
		_ = json.Unmarshal([]byte(spec), &res.Spec)
		_ = json.Unmarshal([]byte(s.openPrivate(private)), &res.Private)
		if res.Spec == nil {
			res.Spec = map[string]any{}
		}
		if res.Private == nil {
			res.Private = map[string]any{}
		}
		if snap.cols[collection] == nil {
			snap.cols[collection] = map[string]Resource{}
		}
		snap.cols[collection][res.Name] = res
		if collection == "keys" {
			if hash := asString(res.Private["secret_sha256"]); hash != "" {
				snap.hashes[hash] = res.Name
			}
		}
	}
	s.snap = snap
	return snap
}

func (s *Store) logger() {
	defer close(s.logDone)
	for item := range s.logs {
		if item.rec != nil {
			s.writeLog(item.rec)
		}
		if item.cache != nil {
			s.writeCache(*item.cache)
		}
		if item.flush != nil {
			close(item.flush)
		}
	}
}

func (s *Store) writeLog(rec map[string]any) {
	id := asString(rec["id"])
	if id == "" {
		id, _ = randomToken("req_", 10)
		rec["id"] = id
	}
	raw, _ := json.Marshal(rec)
	_, _ = s.db.Exec(`INSERT INTO request_logs(id, started_at, model, key_name, provider, status_code, payload) VALUES(?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, model = excluded.model, key_name = excluded.key_name, provider = excluded.provider, status_code = excluded.status_code, payload = excluded.payload`,
		id, asString(rec["started_at"]), asString(rec["model"]), asString(rec["key"]), asString(rec["provider"]), int(asFloat(rec["status_code"])), string(raw))
}

func (s *Store) writeCache(item cacheWrite) {
	flag := 0
	if item.exact {
		flag = 1
	}
	_, _ = s.db.Exec(`INSERT INTO cache_entries(key, model, exact, vector, prompt, response, created_at, hits) VALUES(?, ?, ?, ?, ?, ?, ?, 0)
		ON CONFLICT(key) DO UPDATE SET response = excluded.response, vector = excluded.vector, prompt = excluded.prompt, created_at = excluded.created_at`,
		item.key, item.model, flag, item.vector, item.prompt, item.response, nowRFC())
}

func (s *Store) loadCache() {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.loadCacheLocked()
}

func (s *Store) loadCacheLocked() {
	if s.cacheExact == nil {
		s.cacheExact = map[string]string{}
	}
	rows, err := s.db.Query(`SELECT key, response FROM cache_entries WHERE exact = 1`)
	if err != nil {
		s.cacheLoaded = true
		return
	}
	defer rows.Close()
	for rows.Next() {
		var key, response string
		if rows.Scan(&key, &response) == nil {
			s.cacheExact[key] = response
		}
	}
	s.cacheLoaded = true
}
