package store

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const panelPasswordKey = "panel_password_hash"

// ErrPanelPassword is returned when the typed password does not match.
var ErrPanelPassword = errors.New("incorrect password")

// PanelAuthEnabled reports whether a panel password is stored.
func (s *Store) PanelAuthEnabled() (bool, error) {
	hash, err := s.setting(panelPasswordKey)
	if err != nil {
		return false, err
	}
	return hash != "", nil
}

// ConfigurePanelAuth turns the panel password on or off.
// current is required only when a password is already set.
// An empty password while enabled keeps the existing password.
func (s *Store) ConfigurePanelAuth(enabled bool, password, current string) error {
	hash, err := s.setting(panelPasswordKey)
	if err != nil {
		return err
	}
	if hash != "" {
		if err := checkPassword(hash, current); err != nil {
			return err
		}
	}
	if !enabled {
		if hash == "" {
			return nil
		}
		if err := s.deleteSetting(panelPasswordKey); err != nil {
			return err
		}
		return s.deleteSessions()
	}
	password = strings.TrimSpace(password)
	if password == "" {
		if hash != "" {
			return nil
		}
		return errString("choose a password of at least 8 characters")
	}
	if err := validatePassword(password); err != nil {
		return err
	}
	sum, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := s.setSetting(panelPasswordKey, string(sum)); err != nil {
		return err
	}
	if hash != "" {
		return s.deleteSessions()
	}
	return nil
}

// CheckPanelPassword checks the panel password when protection is on.
func (s *Store) CheckPanelPassword(password string) error {
	hash, err := s.setting(panelPasswordKey)
	if err != nil {
		return err
	}
	if hash == "" {
		return errString("password protection is off")
	}
	return checkPassword(hash, password)
}

// CreateSession stores a new panel session and returns the raw cookie token.
func (s *Store) CreateSession(ttl time.Duration) (string, time.Time, error) {
	if ttl <= 0 {
		ttl = 14 * 24 * time.Hour
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(raw)
	expires := time.Now().UTC().Add(ttl)
	_, err := s.db.Exec(`INSERT INTO panel_sessions (token_hash, expires_at) VALUES (?, ?)`, hashKey(token), expires.Format(time.RFC3339))
	if err != nil {
		return "", time.Time{}, err
	}
	_, _ = s.db.Exec(`DELETE FROM panel_sessions WHERE expires_at < ?`, time.Now().UTC().Format(time.RFC3339))
	return token, expires, nil
}

// ValidSession reports whether the cookie token is still current.
func (s *Store) ValidSession(token string) (bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return false, nil
	}
	sum := hashKey(token)
	var stored, expires string
	err := s.db.QueryRow(`SELECT token_hash, expires_at FROM panel_sessions WHERE token_hash = ?`, sum).Scan(&stored, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if subtle.ConstantTimeCompare([]byte(sum), []byte(stored)) != 1 {
		return false, nil
	}
	when, err := time.Parse(time.RFC3339, expires)
	if err != nil || time.Now().After(when) {
		_, _ = s.db.Exec(`DELETE FROM panel_sessions WHERE token_hash = ?`, sum)
		return false, nil
	}
	return true, nil
}

// DeleteSession removes one panel session.
func (s *Store) DeleteSession(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	_, err := s.db.Exec(`DELETE FROM panel_sessions WHERE token_hash = ?`, hashKey(token))
	return err
}

func checkPassword(hash, password string) error {
	if strings.TrimSpace(password) == "" {
		return ErrPanelPassword
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return ErrPanelPassword
	}
	return nil
}

func validatePassword(password string) error {
	if utf8.RuneCountInString(password) < 8 {
		return errString("choose a password of at least 8 characters")
	}
	if len(password) > 72 {
		return errString("use a password of at most 72 bytes")
	}
	return nil
}

func (s *Store) setting(key string) (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (s *Store) setSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO app_settings (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func (s *Store) deleteSetting(key string) error {
	_, err := s.db.Exec(`DELETE FROM app_settings WHERE key = ?`, key)
	return err
}

func (s *Store) deleteSessions() error {
	_, err := s.db.Exec(`DELETE FROM panel_sessions`)
	return err
}
