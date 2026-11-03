package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"airoute/server/internal/store"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const oidcStateCookie = "wowrouter_oidc"

func (s *Server) oidcStart(w http.ResponseWriter, r *http.Request) {
	conf, err := s.oauthConfig(r)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: state, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil, MaxAge: 600,
	})
	http.Redirect(w, r, conf.AuthCodeURL(state), http.StatusFound)
}

func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(oidcStateCookie)
	if err != nil || cookie.Value == "" || cookie.Value != r.URL.Query().Get("state") {
		writeAPIError(w, http.StatusBadRequest, "OIDC state did not match. Start sign-in again.")
		return
	}
	if problem := r.URL.Query().Get("error"); problem != "" {
		writeAPIError(w, http.StatusBadRequest, problem)
		return
	}
	ctx, provider, err := s.oidcProvider(r)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	conf, err := s.oauthConfig(r)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	token, err := conf.Exchange(ctx, r.URL.Query().Get("code"))
	if err != nil {
		writeAPIError(w, http.StatusUnauthorized, "OIDC token exchange failed.")
		return
	}
	raw, _ := token.Extra("id_token").(string)
	public, err := s.Store.OIDCPublic()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := provider.Verifier(&oidc.Config{ClientID: public.ClientID}).Verify(ctx, raw); err != nil {
		writeAPIError(w, http.StatusUnauthorized, "OIDC token was not accepted.")
		return
	}
	session, expires, err := s.Store.CreateSession(sessionTTL)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setSessionCookie(w, r, session, expires)
	http.SetCookie(w, &http.Cookie{Name: oidcStateCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *Server) saveOIDC(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled      bool   `json:"enabled"`
		Issuer       string `json:"issuer"`
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	saved, err := s.Store.SaveOIDC(body.Enabled, body.Issuer, body.ClientID, body.ClientSecret)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": saved.Enabled, "issuer": saved.Issuer, "clientId": saved.ClientID,
		"hasSecret": saved.HasSecret, "redirectUrl": s.oidcRedirect(r),
	})
}

func (s *Server) saveFeatures(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Compression string `json:"compression"`
		Cache       bool   `json:"cache"`
		CacheTTL    int    `json:"cacheTtl"`
		Memory      bool   `json:"memory"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	saved, err := s.Store.SaveFeatures(store.Features{
		Compression: body.Compression, Cache: body.Cache, CacheTTL: body.CacheTTL, Memory: body.Memory,
	})
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) listMemories(w http.ResponseWriter, _ *http.Request) {
	items, err := s.Store.ListMemories()
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": items})
}

func (s *Server) addMemory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Body string `json:"body"`
	}
	if err := readJSON(r, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	item, err := s.Store.AddMemory(body.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteMemory(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.DeleteMemory(r.PathValue("id")); errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "memory not found")
		return
	} else if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) oauthConfig(r *http.Request) (*oauth2.Config, error) {
	_, provider, err := s.oidcProvider(r)
	if err != nil {
		return nil, err
	}
	public, err := s.Store.OIDCPublic()
	if err != nil {
		return nil, err
	}
	if !public.Enabled {
		return nil, errors.New("OIDC is off")
	}
	secret, err := s.Store.OIDCSecret()
	if err != nil {
		return nil, err
	}
	return &oauth2.Config{
		ClientID: public.ClientID, ClientSecret: secret,
		RedirectURL: s.oidcRedirect(r),
		Endpoint:    provider.Endpoint(),
		Scopes:      []string{oidc.ScopeOpenID, "profile", "email"},
	}, nil
}

func (s *Server) oidcProvider(r *http.Request) (context.Context, *oidc.Provider, error) {
	public, err := s.Store.OIDCPublic()
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(public.Issuer) == "" {
		return nil, nil, errors.New("OIDC is off")
	}
	ctx := r.Context()
	if strings.HasPrefix(public.Issuer, "http://") {
		ctx = oidc.InsecureIssuerURLContext(ctx, public.Issuer)
	}
	provider, err := oidc.NewProvider(ctx, public.Issuer)
	return ctx, provider, err
}

func (s *Server) oidcRedirect(r *http.Request) string {
	scheme := "http"
	if r != nil && r.TLS != nil {
		scheme = "https"
	}
	host := s.Addr
	if r != nil && r.Host != "" {
		host = r.Host
	}
	return scheme + "://" + host + "/api/oidc/callback"
}

func randomState() string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}
