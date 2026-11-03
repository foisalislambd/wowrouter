package admin

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"wowrouter/server/internal/edge"
)

const minPasswordLen = 12

type loginLimit struct {
	mu       sync.Mutex
	failures map[string][]time.Time
}

var passwordAttempts = loginLimit{failures: map[string][]time.Time{}}

func (l *loginLimit) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cut := now.Add(-15 * time.Minute)
	var kept []time.Time
	for _, t := range l.failures[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	l.failures[key] = kept
	return len(kept) < 8
}

func (l *loginLimit) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures[key] = append(l.failures[key], time.Now())
}

func (l *loginLimit) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}

// PasswordLogin reports whether email-and-password sign-in is turned on and a hash is stored.
func localEnabled(spec map[string]any) bool {
	admin := asMap(spec["admin"])
	local := asMap(admin["local"])
	return local["enabled"] == true
}

func (s *Store) PasswordLogin() (enabled bool, email string, hash string) {
	res, err := s.Get("settings", "auth")
	if err != nil {
		return false, "", ""
	}
	admin := asMap(res.Private["admin"])
	if len(admin) == 0 {
		admin = asMap(res.Spec["admin"])
	}
	local := asMap(admin["local"])
	enabled = local["enabled"] == true
	email = asString(local["email"])
	if email == "" {
		email = "admin@localhost"
	}
	hash = asString(res.Private["password_hash"])
	return enabled, email, hash
}

// SetPassword stores a bcrypt hash and the enabled flag. current must match when a hash already exists.
func (s *Store) SetPassword(email, password, current string, enabled bool) error {
	_, _, existing := s.PasswordLogin()
	if existing != "" {
		if bcrypt.CompareHashAndPassword([]byte(existing), []byte(current)) != nil {
			return errPassword
		}
	}
	if enabled && existing == "" && password == "" {
		return errPasswordRequired
	}
	spec := map[string]any{}
	if res, err := s.Get("settings", "auth"); err == nil {
		spec = cloneMap(res.Private)
	}
	admin := asMap(spec["admin"])
	if admin == nil {
		admin = map[string]any{}
	}
	local := asMap(admin["local"])
	if local == nil {
		local = map[string]any{}
	}
	local["enabled"] = enabled
	if strings.TrimSpace(email) != "" {
		local["email"] = strings.TrimSpace(email)
	} else if asString(local["email"]) == "" {
		local["email"] = "admin@localhost"
	}
	admin["local"] = local
	spec["admin"] = admin
	if password != "" {
		if len(password) < minPasswordLen || len(password) > 128 {
			return errPasswordPolicy
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			return err
		}
		spec["password_hash"] = string(hash)
	}
	_, err := s.Put("settings", "auth", spec, "", true)
	return err
}

var (
	errPassword         = errors.New("current password did not match")
	errPasswordRequired = errors.New("set a password before turning password login on")
	errPasswordPolicy   = errors.New("use 12 to 128 characters")
)

// CheckPassword is true when password login is enabled and the email and password match.
func (s *Store) CheckPassword(email, password string) bool {
	enabled, want, hash := s.PasswordLogin()
	if !enabled || hash == "" || password == "" {
		return false
	}
	if email != "" && !strings.EqualFold(strings.TrimSpace(email), want) {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func (a *API) passwordSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		enabled, email, hash := a.Store.PasswordLogin()
		writeJSON(w, http.StatusOK, map[string]any{"enabled": enabled, "email": email, "configured": hash != ""})
	case http.MethodPut, http.MethodPost:
		var raw map[string]any
		if err := readBody(r, &raw); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
		enabled, _ := raw["enabled"].(bool)
		if err := a.Store.SetPassword(asString(raw["email"]), asString(raw["password"]), asString(raw["current_password"]), enabled); err != nil {
			code := "invalid_body"
			status := http.StatusBadRequest
			if errors.Is(err, errPassword) {
				status = http.StatusUnauthorized
				code = "unauthenticated"
			}
			writeErr(w, status, code, err.Error())
			return
		}
		enabled, email, hash := a.Store.PasswordLogin()
		a.Store.AddAudit(map[string]any{"action": "update", "resource": "settings/auth", "detail": "password login"})
		writeJSON(w, http.StatusOK, map[string]any{"enabled": enabled, "email": email, "configured": hash != ""})
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "That method is not allowed here.")
	}
}

func (a *API) loginOptions(w http.ResponseWriter, _ *http.Request) {
	methods := []any{map[string]any{"type": "token", "id": "token", "display_name": "Admin token"}}
	enabled, _, hash := a.Store.PasswordLogin()
	passwordOn := (enabled && hash != "") || len(a.Store.Resources("users")) > 0
	if passwordOn {
		methods = append([]any{map[string]any{"type": "local", "id": "local", "display_name": "Password"}}, methods...)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"methods":              methods,
		"password_reset":       false,
		"organization":         nil,
		"version":              a.Version,
		"ticker":               nil,
		"trusted_device":       map[string]any{"enabled": false, "max_age_days": nil},
		"password":             map[string]any{"min_length": minPasswordLen, "max_length": 128},
		"setup_required":       false,
		"device_authorization": false,
	})
}

func (a *API) acceptLogin(w http.ResponseWriter, token, email, password, ip string) bool {
	if token != "" && a.Store.BootstrapMatches(token) {
		return a.startSession(w)
	}
	if password != "" {
		if !passwordAttempts.allow(ip) {
			writeErr(w, http.StatusTooManyRequests, "rate_limited", "Too many attempts. Wait a few minutes, then try again.")
			return false
		}
		enabled, _, hash := a.Store.PasswordLogin()
		if !enabled || hash == "" {
			writeErr(w, http.StatusForbidden, "local_login_disabled", "Password sign-in is turned off.")
			return false
		}
		if !a.Store.CheckPassword(email, password) {
			passwordAttempts.fail(ip)
			writeErr(w, http.StatusUnauthorized, "unauthenticated", "That email or password didn't work.")
			return false
		}
		passwordAttempts.reset(ip)
		return a.startSession(w)
	}
	writeErr(w, http.StatusUnauthorized, "unauthenticated", "That token didn't work.")
	return false
}

func (a *API) startSession(w http.ResponseWriter) bool {
	raw, err := a.Store.CreateSession()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return false
	}
	http.SetCookie(w, &http.Cookie{Name: "wowrouter_session", Value: raw, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, me())
	return true
}

func (a *API) localLogin(w http.ResponseWriter, r *http.Request) {
	var raw map[string]any
	if err := readBody(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	email, password := asString(raw["email"]), asString(raw["password"])
	ip := clientIP(r)
	if !passwordAttempts.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "Too many attempts. Wait a few minutes, then try again.")
		return
	}
	if a.Store.CheckPassword(email, password) {
		passwordAttempts.reset(ip)
		a.writeSession(w, "bootstrap", "admin")
		return
	}
	if _, role, ok := a.Store.CheckUser(email, password); ok {
		passwordAttempts.reset(ip)
		a.writeSession(w, email, role)
		return
	}
	enabled, _, hash := a.Store.PasswordLogin()
	if (!enabled || hash == "") && len(a.Store.Resources("users")) == 0 {
		writeErr(w, http.StatusForbidden, "local_login_disabled", "Password sign-in is turned off.")
		return
	}
	passwordAttempts.fail(ip)
	writeErr(w, http.StatusUnauthorized, "unauthenticated", "That email or password didn't work.")
}

func (a *API) writeSession(w http.ResponseWriter, principal, role string) {
	token, err := a.Store.CreateSessionFor(principal, role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "wowrouter_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]any{"next": "done"})
}

func clientIP(r *http.Request) string {
	if ip := edge.ClientIP(r); ip != "" && ip != r.RemoteAddr {
		return ip
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	return host
}
