package httpapi

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/oauthflow"
	"airoute/server/internal/store"
)

type oauthPending struct {
	DeviceCode string
	ClientID   string
	TokenURL   string
	Interval   time.Duration
}

func (s *Server) oauthDevice(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	def, ok := catalog.BySlug(slug)
	if !ok {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	if def.Protocol != catalog.ProtocolOAuthDevice {
		writeAPIError(w, http.StatusBadRequest, "this provider does not use device sign-in")
		return
	}
	var body struct {
		ClientID string `json:"clientId"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	clientID := strings.TrimSpace(body.ClientID)
	if clientID == "" {
		writeAPIError(w, http.StatusBadRequest, "enter the OAuth app client id")
		return
	}
	base, _, _, _, err := s.Store.ProviderSecret(slug)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "set the enterprise base URL first")
		return
	}
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		writeAPIError(w, http.StatusBadRequest, "set the enterprise base URL first")
		return
	}
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("scope", "read:user")
	header := http.Header{}
	header.Set("Content-Type", "application/x-www-form-urlencoded")
	header.Set("Accept", "application/json")
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, base+"/login/device/code", []byte(form.Encode()), header)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		writeAPIError(w, http.StatusBadGateway, upstreamErrorMessage(payload))
		return
	}
	code, err := oauthflow.ParseDevice(payload)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	s.oauthMu.Lock()
	if s.oauthPending == nil {
		s.oauthPending = map[string]oauthPending{}
	}
	s.oauthPending[slug] = oauthPending{
		DeviceCode: code.DeviceCode, ClientID: clientID,
		TokenURL: base + "/login/oauth/access_token", Interval: time.Duration(code.Interval) * time.Second,
	}
	s.oauthMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"userCode": code.UserCode, "verificationUri": code.VerificationURI, "interval": code.Interval,
	})
}

func (s *Server) oauthPoll(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	s.oauthMu.Lock()
	pending, ok := s.oauthPending[slug]
	s.oauthMu.Unlock()
	if !ok {
		writeAPIError(w, http.StatusBadRequest, "start sign-in first")
		return
	}
	form := url.Values{}
	form.Set("client_id", pending.ClientID)
	form.Set("device_code", pending.DeviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	header := http.Header{}
	header.Set("Content-Type", "application/x-www-form-urlencoded")
	header.Set("Accept", "application/json")
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, pending.TokenURL, []byte(form.Encode()), header)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	token, err := oauthflow.ParseToken(payload)
	if err != nil && (err.Error() == "authorization_pending" || err.Error() == "slow_down") {
		writeJSON(w, http.StatusAccepted, map[string]any{"pending": true})
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	token.ClientID = pending.ClientID
	token.TokenURL = pending.TokenURL
	saved := oauthflow.Encode(token)
	if _, err := s.Store.UpdateProvider(slug, store.ProviderUpdate{APIKey: &saved}); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.oauthMu.Lock()
	delete(s.oauthPending, slug)
	s.oauthMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"pending": false, "saved": true})
}

func (s *Server) pingAdapted(w http.ResponseWriter, r *http.Request, baseURL string) {
	header := http.Header{}
	header.Set("Accept", "application/json")
	resp, err := s.OpenAI.Send(r.Context(), http.MethodGet, strings.TrimRight(baseURL, "/"), nil, header)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 500 {
		writeAPIError(w, http.StatusBadGateway, "the provider returned "+resp.Status)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": resp.StatusCode})
}
