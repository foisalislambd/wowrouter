package httpapi

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"airoute/server/internal/store"
)

const (
	sessionCookie = "wowrouter_session"
	sessionTTL    = 14 * 24 * time.Hour
	signInMessage = "Sign in to use the panel."
)

func (s *Server) allowPanel(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		return true
	}
	if r.URL.Path == "/api/session" && (r.Method == http.MethodGet || r.Method == http.MethodPost) {
		return true
	}
	if s.Store == nil {
		return true
	}
	on, err := s.Store.PanelAuthEnabled()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if !on {
		return true
	}
	ok, err := s.sessionOK(r)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if ok {
		return true
	}
	writeAPIError(w, http.StatusUnauthorized, signInMessage)
	return false
}

func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	on, err := s.panelOn()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ok, err := s.sessionOK(r)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authRequired": on, "authenticated": !on || ok})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	on, err := s.panelOn()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !on {
		writeAPIError(w, http.StatusBadRequest, "Password protection is off.")
		return
	}
	if !s.allowLogin(clientIP(r)) {
		writeAPIError(w, http.StatusTooManyRequests, "Too many sign-in attempts. Wait a few minutes and try again.")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := s.Store.CheckPanelPassword(body.Password); err != nil {
		s.noteLoginFailure(clientIP(r))
		if errors.Is(err, store.ErrPanelPassword) {
			writeAPIError(w, http.StatusUnauthorized, "Incorrect password.")
			return
		}
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	token, expires, err := s.Store.CreateSession(sessionTTL)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(w, r, token, expires)
	writeJSON(w, http.StatusOK, map[string]any{"authRequired": true, "authenticated": true})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		_ = s.Store.DeleteSession(cookie.Value)
	}
	clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) savePanelAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled         bool   `json:"enabled"`
		Password        string `json:"password"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	wasOn, err := s.panelOn()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.Store.ConfigurePanelAuth(body.Enabled, body.Password, body.CurrentPassword); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, store.ErrPanelPassword) {
			status = http.StatusUnauthorized
		}
		writeAPIError(w, status, err.Error())
		return
	}
	nowOn, err := s.panelOn()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	signedOut := wasOn && nowOn && strings.TrimSpace(body.Password) != ""
	if !wasOn && nowOn {
		token, expires, err := s.Store.CreateSession(sessionTTL)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		setSessionCookie(w, r, token, expires)
	}
	if signedOut || !nowOn {
		if cookie, err := r.Cookie(sessionCookie); err == nil {
			_ = s.Store.DeleteSession(cookie.Value)
		}
		clearSessionCookie(w)
	}
	writeJSON(w, http.StatusOK, map[string]any{"authRequired": nowOn, "signedOut": signedOut})
}

func (s *Server) panelOn() (bool, error) {
	if s.Store == nil {
		return false, nil
	}
	return s.Store.PanelAuthEnabled()
}

func (s *Server) sessionOK(r *http.Request) (bool, error) {
	if s.Store == nil {
		return false, nil
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return false, nil
	}
	return s.Store.ValidSession(cookie.Value)
}

func (s *Server) allowLogin(ip string) bool {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	if s.loginAttempts == nil {
		s.loginAttempts = map[string][]time.Time{}
	}
	cutoff := time.Now().Add(-10 * time.Minute)
	kept := s.loginAttempts[ip][:0]
	for _, at := range s.loginAttempts[ip] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	s.loginAttempts[ip] = kept
	return len(kept) < 8
}

func (s *Server) noteLoginFailure(ip string) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	if s.loginAttempts == nil {
		s.loginAttempts = map[string][]time.Time{}
	}
	s.loginAttempts[ip] = append(s.loginAttempts[ip], time.Now())
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
