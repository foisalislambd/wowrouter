// Package oauth runs PKCE and device-code logins for subscription providers.
// Client ids are the public desktop-app ids (PKCE, not a confidential secret).
// Override them with WOWROUTER_OAUTH_<PROVIDER>_CLIENT_ID.
package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Provider is one subscription login.
type Provider struct {
	ID           string
	AuthorizeURL string
	TokenURL     string
	DeviceURL    string
	Scopes       string
	ClientID     string
	Extra        url.Values
	Redirect     string
}

// Result is a token response worth storing.
type Result struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	Email        string    `json:"email"`
}

type pending struct {
	Provider string
	Verifier string
	Expires  time.Time
}

var (
	mu     sync.Mutex
	states = map[string]pending{}
)

// Catalog is the built-in subscription providers.
func Catalog() map[string]Provider {
	return map[string]Provider{
		"claude": {
			ID: "claude", AuthorizeURL: "https://claude.ai/oauth/authorize", TokenURL: "https://console.anthropic.com/v1/oauth/token",
			Scopes:   "org:create_api_key user:profile user:inference user:sessions:claude_code",
			ClientID: env("WOWROUTER_OAUTH_CLAUDE_CLIENT_ID", "9d1c250a-e61b-44d9-88ed-5944d1962f5e"),
			Redirect: env("WOWROUTER_OAUTH_CLAUDE_REDIRECT", "http://127.0.0.1:8787/oauth/claude/callback"),
		},
		"codex": {
			ID: "codex", AuthorizeURL: "https://auth.openai.com/oauth/authorize", TokenURL: "https://auth.openai.com/oauth/token",
			Scopes:   "openid profile email offline_access",
			ClientID: env("WOWROUTER_OAUTH_CODEX_CLIENT_ID", "app_EMoamEEZ73f0CkXaXp7hrann"),
			Redirect: env("WOWROUTER_OAUTH_CODEX_REDIRECT", "http://127.0.0.1:8787/oauth/codex/callback"),
			Extra:    url.Values{"codex_cli_simplified_flow": {"true"}, "prompt": {"login"}},
		},
		"github": {
			ID: "github", AuthorizeURL: "https://github.com/login/oauth/authorize", TokenURL: "https://github.com/login/oauth/access_token",
			DeviceURL: "https://github.com/login/device/code",
			Scopes:    "read:user",
			ClientID:  env("WOWROUTER_OAUTH_GITHUB_CLIENT_ID", "Iv1.b507a08c87ecfe98"),
			Redirect:  env("WOWROUTER_OAUTH_GITHUB_REDIRECT", "http://127.0.0.1:8787/oauth/github/callback"),
		},
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// Start begins a PKCE login and returns the browser URL and state.
func Start(id string) (authURL, state string, err error) {
	p, ok := Catalog()[id]
	if !ok {
		return "", "", fmt.Errorf("unknown provider %s", id)
	}
	if p.ClientID == "" || p.AuthorizeURL == "" {
		return "", "", errors.New("this provider has no OAuth client id")
	}
	verifier, err := random(32)
	if err != nil {
		return "", "", err
	}
	state, err = random(16)
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	mu.Lock()
	states[state] = pending{Provider: id, Verifier: verifier, Expires: time.Now().Add(10 * time.Minute)}
	mu.Unlock()
	q := url.Values{}
	q.Set("client_id", p.ClientID)
	q.Set("redirect_uri", p.Redirect)
	q.Set("response_type", "code")
	q.Set("scope", p.Scopes)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	for k, vs := range p.Extra {
		for _, v := range vs {
			q.Set(k, v)
		}
	}
	return p.AuthorizeURL + "?" + q.Encode(), state, nil
}

// Exchange finishes PKCE. The state must match a Start from this process.
func Exchange(ctx context.Context, id, state, code string, client *http.Client) (Result, error) {
	mu.Lock()
	item, ok := states[state]
	if ok {
		delete(states, state)
	}
	mu.Unlock()
	if !ok || item.Provider != id || time.Now().After(item.Expires) {
		return Result{}, errors.New("that sign-in expired; start it again")
	}
	p := Catalog()[id]
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", p.Redirect)
	form.Set("client_id", p.ClientID)
	form.Set("code_verifier", item.Verifier)
	return postToken(ctx, p.TokenURL, form, client)
}

// Refresh uses a refresh token.
func Refresh(ctx context.Context, id, refresh string, client *http.Client) (Result, error) {
	p, ok := Catalog()[id]
	if !ok {
		return Result{}, fmt.Errorf("unknown provider %s", id)
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refresh)
	form.Set("client_id", p.ClientID)
	return postToken(ctx, p.TokenURL, form, client)
}

// TokenEndpoint replaces the catalog token URL when set. Tests use it.
var TokenEndpoint string

// HTTPClient is used when a caller does not pass one.
var HTTPClient *http.Client

func postToken(ctx context.Context, endpoint string, form url.Values, client *http.Client) (Result, error) {
	if TokenEndpoint != "" {
		endpoint = TokenEndpoint
	}
	if client == nil {
		client = HTTPClient
	}
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return Result{}, fmt.Errorf("token endpoint returned %d", resp.StatusCode)
	}
	var body struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
	}
	if json.Unmarshal(raw, &body) != nil || body.AccessToken == "" {
		return Result{}, errors.New("the token response had no access token")
	}
	if body.Error != "" {
		return Result{}, errors.New(body.Error)
	}
	exp := time.Time{}
	if body.ExpiresIn > 0 {
		exp = time.Now().Add(time.Duration(body.ExpiresIn) * time.Second)
	}
	return Result{AccessToken: body.AccessToken, RefreshToken: body.RefreshToken, ExpiresAt: exp}, nil
}

func random(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
