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
	Flow         string
	AuthorizeURL string
	TokenURL     string
	DeviceURL    string
	PollURL      string
	Scopes       string
	ClientID     string
	ClientSecret string
	Extra        url.Values
	Redirect     string
}

// DeviceCode is a sign-in the user finishes in a browser on another machine.
type DeviceCode struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	Interval        int    `json:"interval"`
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
			ID: "claude", Flow: "pkce", AuthorizeURL: "https://claude.ai/oauth/authorize", TokenURL: "https://console.anthropic.com/v1/oauth/token",
			Scopes:   "org:create_api_key user:profile user:inference user:sessions:claude_code",
			ClientID: env("WOWROUTER_OAUTH_CLAUDE_CLIENT_ID", "9d1c250a-e61b-44d9-88ed-5944d1962f5e"),
			Redirect: env("WOWROUTER_OAUTH_CLAUDE_REDIRECT", "http://127.0.0.1:8787/oauth/claude/callback"),
		},
		"codex": {
			ID: "codex", Flow: "pkce", AuthorizeURL: "https://auth.openai.com/oauth/authorize", TokenURL: "https://auth.openai.com/oauth/token",
			Scopes:   "openid profile email offline_access",
			ClientID: env("WOWROUTER_OAUTH_CODEX_CLIENT_ID", "app_EMoamEEZ73f0CkXaXp7hrann"),
			Redirect: env("WOWROUTER_OAUTH_CODEX_REDIRECT", "http://127.0.0.1:8787/oauth/codex/callback"),
			Extra:    url.Values{"codex_cli_simplified_flow": {"true"}, "prompt": {"login"}},
		},
		"github": {
			ID: "github", Flow: "pkce", AuthorizeURL: "https://github.com/login/oauth/authorize", TokenURL: "https://github.com/login/oauth/access_token",
			DeviceURL: "https://github.com/login/device/code",
			Scopes:    "read:user",
			ClientID:  env("WOWROUTER_OAUTH_GITHUB_CLIENT_ID", "Iv1.b507a08c87ecfe98"),
			Redirect:  env("WOWROUTER_OAUTH_GITHUB_REDIRECT", "http://127.0.0.1:8787/oauth/github/callback"),
		},
		"github-copilot": {
			ID: "github-copilot", Flow: "device", DeviceURL: "https://github.com/login/device/code",
			TokenURL: "https://github.com/login/oauth/access_token",
			Scopes:   "read:user",
			ClientID: env("WOWROUTER_OAUTH_COPILOT_CLIENT_ID", env("WOWROUTER_OAUTH_GITHUB_CLIENT_ID", "Iv1.b507a08c87ecfe98")),
		},
		"gemini": {
			ID: "gemini", Flow: "device", DeviceURL: "https://oauth2.googleapis.com/device/code",
			TokenURL: "https://oauth2.googleapis.com/token",
			Scopes:   "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email",
			ClientID: env("WOWROUTER_OAUTH_GEMINI_CLIENT_ID", ""),
		},
		"antigravity": {
			ID: "antigravity", Flow: "pkce", AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL:     "https://oauth2.googleapis.com/token",
			Scopes:       "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email",
			ClientID:     env("WOWROUTER_OAUTH_ANTIGRAVITY_CLIENT_ID", ""),
			ClientSecret: env("WOWROUTER_OAUTH_ANTIGRAVITY_CLIENT_SECRET", ""),
			Redirect:     env("WOWROUTER_OAUTH_ANTIGRAVITY_REDIRECT", "http://127.0.0.1:8787/oauth/antigravity/callback"),
		},
		"kiro": {
			ID: "kiro", Flow: "device",
			DeviceURL: "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/device/authorization",
			TokenURL:  "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
			Scopes:    "codewhisperer:completions codewhisperer:analysis codewhisperer:conversations",
			ClientID:  env("WOWROUTER_OAUTH_KIRO_CLIENT_ID", "kiro-cli"),
		},
		"cursor": {
			ID: "cursor", Flow: "cursor",
			AuthorizeURL: "https://cursor.com/loginDeepControl",
			PollURL:      "https://api2.cursor.sh/auth/poll",
		},
		"cline": {
			ID: "cline", Flow: "pkce", AuthorizeURL: "https://api.cline.bot/api/v1/auth/authorize",
			TokenURL: "https://api.cline.bot/api/v1/auth/token",
			Scopes:   "openid profile",
			ClientID: env("WOWROUTER_OAUTH_CLINE_CLIENT_ID", ""),
			Redirect: env("WOWROUTER_OAUTH_CLINE_REDIRECT", "http://127.0.0.1:8787/oauth/cline/callback"),
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

// StartDevice asks the provider for a user code.
func StartDevice(ctx context.Context, id string, client *http.Client) (DeviceCode, error) {
	p, ok := Catalog()[id]
	if !ok || p.Flow != "device" {
		return DeviceCode{}, fmt.Errorf("unknown device provider %s", id)
	}
	if p.ClientID == "" || p.DeviceURL == "" {
		return DeviceCode{}, errors.New("set the OAuth client id for this provider before starting sign-in")
	}
	form := url.Values{}
	form.Set("client_id", p.ClientID)
	form.Set("scope", p.Scopes)
	if p.ClientSecret != "" {
		form.Set("client_secret", p.ClientSecret)
	}
	endpoint := p.DeviceURL
	if DeviceEndpoint != "" {
		endpoint = DeviceEndpoint
	}
	body, err := postForm(ctx, endpoint, form, client)
	if err != nil {
		return DeviceCode{}, err
	}
	var parsed struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		VerificationURL string `json:"verification_url"`
		Interval        int    `json:"interval"`
		Error           string `json:"error"`
	}
	if json.Unmarshal(body, &parsed) != nil || parsed.DeviceCode == "" {
		return DeviceCode{}, errors.New("the provider did not return a device code")
	}
	if parsed.Error != "" {
		return DeviceCode{}, errors.New(parsed.Error)
	}
	uri := parsed.VerificationURI
	if uri == "" {
		uri = parsed.VerificationURL
	}
	if parsed.Interval <= 0 {
		parsed.Interval = 5
	}
	return DeviceCode{DeviceCode: parsed.DeviceCode, UserCode: parsed.UserCode, VerificationURI: uri, Interval: parsed.Interval}, nil
}

// PollDevice exchanges a device code. authorization_pending is not a failure of the request.
func PollDevice(ctx context.Context, id, deviceCode string, client *http.Client) (Result, string, error) {
	p, ok := Catalog()[id]
	if !ok {
		return Result{}, "", fmt.Errorf("unknown provider %s", id)
	}
	form := url.Values{}
	form.Set("client_id", p.ClientID)
	form.Set("device_code", deviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	endpoint := p.TokenURL
	if TokenEndpoint != "" {
		endpoint = TokenEndpoint
	}
	body, err := postForm(ctx, endpoint, form, client)
	if err != nil {
		return Result{}, "", err
	}
	var pending struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &pending)
	if pending.Error == "authorization_pending" || pending.Error == "slow_down" {
		return Result{}, pending.Error, nil
	}
	result, err := resultFrom(body)
	return result, "", err
}

// StartCursor begins Cursor's deep-control login. The user opens the URL, then the panel polls.
func StartCursor() (authURL, uuid string, err error) {
	uuid, err = random(16)
	if err != nil {
		return "", "", err
	}
	challenge, err := random(16)
	if err != nil {
		return "", "", err
	}
	p := Catalog()["cursor"]
	return p.AuthorizeURL + "?challenge=" + url.QueryEscape(challenge) + "&uuid=" + url.QueryEscape(uuid) + "&mode=login", uuid, nil
}

// PollCursor reads a finished Cursor login.
func PollCursor(ctx context.Context, uuid string, client *http.Client) (Result, string, error) {
	p := Catalog()["cursor"]
	endpoint := p.PollURL
	if PollEndpoint != "" {
		endpoint = PollEndpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?uuid="+url.QueryEscape(uuid), nil)
	if err != nil {
		return Result{}, "", err
	}
	if client == nil {
		client = HTTPClient
	}
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusAccepted {
		return Result{}, "authorization_pending", nil
	}
	result, err := resultFrom(raw)
	return result, "", err
}

// DeviceEndpoint replaces the device-code URL in tests.
var DeviceEndpoint string

// PollEndpoint replaces the Cursor poll URL in tests.
var PollEndpoint string

func postForm(ctx context.Context, endpoint string, form url.Values, client *http.Client) ([]byte, error) {
	if client == nil {
		client = HTTPClient
	}
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("token endpoint returned %d", resp.StatusCode)
	}
	return raw, nil
}

func resultFrom(raw []byte) (Result, error) {
	var body struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
	}
	if json.Unmarshal(raw, &body) != nil || body.AccessToken == "" {
		if body.Error != "" {
			return Result{}, errors.New(body.Error)
		}
		return Result{}, errors.New("the token response had no access token")
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
