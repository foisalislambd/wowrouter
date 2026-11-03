package admin

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// SaveBatch stores a finished or in-progress batch.
func (s *Store) SaveBatch(id string, item map[string]any) error {
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO batches(id, payload, created_at) VALUES(?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, id, string(raw), nowRFC())
	return err
}

// Batch loads one batch.
func (s *Store) Batch(id string) (map[string]any, bool) {
	var payload string
	if s.db.QueryRow(`SELECT payload FROM batches WHERE id = ?`, id).Scan(&payload) != nil {
		return nil, false
	}
	var item map[string]any
	if json.Unmarshal([]byte(payload), &item) != nil {
		return nil, false
	}
	return item, true
}

// Batches lists stored batches, newest id last.
func (s *Store) Batches() []map[string]any {
	rows, err := s.db.Query(`SELECT payload FROM batches ORDER BY created_at`)
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
		var item map[string]any
		if json.Unmarshal([]byte(payload), &item) == nil {
			out = append(out, item)
		}
	}
	return out
}

// SaveEval stores one eval run.
func (s *Store) SaveEval(id string, item map[string]any) error {
	raw, _ := json.Marshal(item)
	_, err := s.db.Exec(`INSERT INTO eval_runs(id, payload, created_at) VALUES(?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, id, string(raw), nowRFC())
	return err
}

// Evals lists stored runs.
func (s *Store) Evals() []map[string]any {
	rows, err := s.db.Query(`SELECT payload FROM eval_runs ORDER BY created_at`)
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
		var item map[string]any
		if json.Unmarshal([]byte(payload), &item) == nil {
			out = append(out, item)
		}
	}
	return out
}

// SaveTask stores an A2A task.
func (s *Store) SaveTask(id string, item map[string]any) error {
	raw, _ := json.Marshal(item)
	_, err := s.db.Exec(`INSERT INTO a2a_tasks(id, payload, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`, id, string(raw), nowRFC())
	return err
}

// Task loads an A2A task.
func (s *Store) Task(id string) (map[string]any, bool) {
	var payload string
	if s.db.QueryRow(`SELECT payload FROM a2a_tasks WHERE id = ?`, id).Scan(&payload) != nil {
		return nil, false
	}
	var item map[string]any
	if json.Unmarshal([]byte(payload), &item) != nil {
		return nil, false
	}
	return item, true
}

// UpsertUser stores a console user. role is admin, operator, or viewer.
func (s *Store) UpsertUser(email, password, role string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	switch role {
	case "admin", "operator", "viewer":
	default:
		return errPasswordPolicy
	}
	if len(password) < minPasswordLen || len(password) > 128 {
		return errPasswordPolicy
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	name := strings.ReplaceAll(email, "@", "_at_")
	_, err = s.Put("users", name, map[string]any{
		"email": email, "role": role, "enabled": true, "password_hash": string(hash),
	}, "", true)
	return err
}

// CheckUser reports a matching console user.
func (s *Store) CheckUser(email, password string) (name, role string, ok bool) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || password == "" {
		return "", "", false
	}
	for _, user := range s.Resources("users") {
		if !strings.EqualFold(asString(user.Spec["email"]), email) && !strings.EqualFold(asString(user.Private["email"]), email) {
			continue
		}
		if user.Spec["enabled"] == false {
			return "", "", false
		}
		hash := asString(user.Private["password_hash"])
		role = asString(user.Spec["role"])
		if role == "" {
			role = asString(user.Private["role"])
		}
		if hash == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
			return "", "", false
		}
		return user.Name, role, true
	}
	return "", "", false
}

// Snapshot copies resource rows for a peer that shares secret.key.
func (s *Store) Snapshot() (int64, []map[string]any, error) {
	rows, err := s.db.Query(`SELECT collection, name, spec, private, etag, generation, created_at, updated_at, managed_by FROM resources`)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var col, name, spec, private, etag, created, updated, managed string
		var gen int64
		if rows.Scan(&col, &name, &spec, &private, &etag, &gen, &created, &updated, &managed) != nil {
			continue
		}
		items = append(items, map[string]any{
			"collection": col, "name": name, "spec": spec, "private": private,
			"etag": etag, "generation": gen, "created_at": created, "updated_at": updated, "managed_by": managed,
		})
	}
	return s.Generation(), items, rows.Err()
}

// ApplySnapshot writes peer rows when the peer generation is newer.
func (s *Store) ApplySnapshot(gen int64, items []map[string]any) error {
	if gen <= s.Generation() {
		return nil
	}
	for _, item := range items {
		_, err := s.db.Exec(`INSERT INTO resources(collection, name, spec, private, etag, generation, created_at, updated_at, managed_by)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(collection, name) DO UPDATE SET spec = excluded.spec, private = excluded.private, etag = excluded.etag, generation = excluded.generation, updated_at = excluded.updated_at`,
			asString(item["collection"]), asString(item["name"]), asString(item["spec"]), asString(item["private"]),
			asString(item["etag"]), int64(asFloat(item["generation"])), asString(item["created_at"]), asString(item["updated_at"]), orString(asString(item["managed_by"]), "sync"))
		if err != nil {
			return err
		}
	}
	if _, err := s.db.Exec(`INSERT INTO meta(k, v) VALUES('generation', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, itoa64(gen)); err != nil {
		return err
	}
	s.mu.Lock()
	s.gen = gen
	s.snap = nil
	s.mu.Unlock()
	return nil
}

func orString(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func itoa64(n int64) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(
		jsonNumber(n), ",", ""), " ", ""))
}

func jsonNumber(n int64) string {
	raw, _ := json.Marshal(n)
	return string(raw)
}

// Ping reports whether the database answers.
func (s *Store) Ping() error {
	if s == nil || s.db == nil {
		return errPasswordRequired
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.db.PingContext(ctx)
}
