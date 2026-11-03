// Package oauthflow builds device-code and PKCE sign-in steps.
// Tokens are returned to the caller, which encrypts them before saving.
package oauthflow

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
)

// DeviceCode is the first step of a device login.
type DeviceCode struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	Interval        int    `json:"interval"`
	ExpiresIn       int    `json:"expires_in"`
}

// Token is an access token and, when the server sent one, a refresh token.
type Token struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenURL     string `json:"token_url,omitempty"`
	ClientID     string `json:"client_id,omitempty"`
	ExpiresIn    int    `json:"expires_in"`
}

// ParseDevice reads a device-code response.
func ParseDevice(body []byte) (DeviceCode, error) {
	var code DeviceCode
	if err := json.Unmarshal(body, &code); err != nil {
		return DeviceCode{}, err
	}
	if code.VerificationURI == "" {
		var alt struct {
			URI string `json:"verification_uri_complete"`
		}
		_ = json.Unmarshal(body, &alt)
		code.VerificationURI = alt.URI
	}
	if code.DeviceCode == "" || code.UserCode == "" || code.VerificationURI == "" {
		return DeviceCode{}, errors.New("device response is missing a code")
	}
	if code.Interval < 1 {
		code.Interval = 5
	}
	return code, nil
}

// ParseToken reads a token response. authorization_pending is returned as an error.
func ParseToken(body []byte) (Token, error) {
	var pending struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &pending)
	if pending.Error == "authorization_pending" || pending.Error == "slow_down" {
		return Token{}, errors.New(pending.Error)
	}
	if pending.Error != "" {
		return Token{}, errors.New(pending.Error)
	}
	var token Token
	if err := json.Unmarshal(body, &token); err != nil {
		return Token{}, err
	}
	if token.AccessToken == "" {
		return Token{}, errors.New("token response has no access token")
	}
	return token, nil
}

// Encode stores a token as JSON when it can be refreshed. A bare access token is returned as-is.
func Encode(token Token) string {
	if token.RefreshToken == "" && token.TokenURL == "" {
		return token.AccessToken
	}
	raw, err := json.Marshal(token)
	if err != nil {
		return token.AccessToken
	}
	return string(raw)
}

// Decode reads Encode output. A raw bearer token is returned unchanged.
func Decode(saved string) Token {
	saved = strings.TrimSpace(saved)
	if !strings.HasPrefix(saved, "{") {
		return Token{AccessToken: saved}
	}
	var token Token
	if json.Unmarshal([]byte(saved), &token) != nil || token.AccessToken == "" {
		return Token{AccessToken: saved}
	}
	return token
}

// Verifier creates a PKCE verifier and its S256 challenge.
func Verifier() (verifier, challenge string, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return verifier, challenge, nil
}

// AuthURL is the browser URL for a public PKCE client.
func AuthURL(authorize, clientID, redirect, challenge, state, scope string) (string, error) {
	parsed, err := url.Parse(authorize)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("authorize URL must be absolute")
	}
	query := parsed.Query()
	query.Set("response_type", "code")
	query.Set("client_id", clientID)
	query.Set("redirect_uri", redirect)
	query.Set("code_challenge", challenge)
	query.Set("code_challenge_method", "S256")
	query.Set("state", state)
	if scope != "" {
		query.Set("scope", scope)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
