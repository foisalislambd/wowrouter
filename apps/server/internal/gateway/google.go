package gateway

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const googleScope = "https://www.googleapis.com/auth/cloud-platform"

type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

type cachedGoogleToken struct {
	token string
	until time.Time
}

var googleTokenCache struct {
	mu sync.Mutex
	m  map[string]cachedGoogleToken
}

func (e *Engine) googleToken(ctx context.Context, spec, priv map[string]any, key string) (string, error) {
	raw := serviceAccountJSON(spec, priv)
	if raw == "" && isServiceAccountJSON(key) {
		raw = key
	}
	if raw == "" {
		return key, nil
	}
	client := http.DefaultClient
	if e != nil && e.HTTP != nil {
		client = e.HTTP
	}
	token, err := exchangeServiceAccount(ctx, client, raw)
	if err != nil {
		return "", err
	}
	return token, nil
}

func serviceAccountJSON(spec, priv map[string]any) string {
	for _, src := range []map[string]any{priv, spec} {
		auth := asMap(src["auth"])
		raw := strings.TrimSpace(asString(auth["service_account_json"]))
		if raw != "" && raw != "[REDACTED]" {
			return raw
		}
	}
	return ""
}

func isServiceAccountJSON(raw string) bool {
	raw = strings.TrimSpace(raw)
	return strings.HasPrefix(raw, "{") && strings.Contains(raw, "private_key")
}

// ValidateServiceAccount checks that a Google service account key can be signed with.
func ValidateServiceAccount(raw string) error {
	_, _, err := parseServiceAccount(raw)
	return err
}

func parseServiceAccount(raw string) (serviceAccount, *rsa.PrivateKey, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 64<<10 {
		return serviceAccount{}, nil, fmt.Errorf("service account JSON is missing or too large")
	}
	var sa serviceAccount
	if json.Unmarshal([]byte(raw), &sa) != nil || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return serviceAccount{}, nil, fmt.Errorf("service account JSON needs client_email and private_key")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	if err := SafeHTTPURL(sa.TokenURI); err != nil {
		return serviceAccount{}, nil, fmt.Errorf("service account token_uri: %w", err)
	}
	key, err := parseRSAKey(sa.PrivateKey)
	if err != nil {
		return serviceAccount{}, nil, err
	}
	return sa, key, nil
}

func parseRSAKey(pemText string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemText))
	if block == nil {
		return nil, fmt.Errorf("service account private_key is not PEM")
	}
	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	default:
		parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("service account private_key: %w", err)
		}
		key, ok := parsed.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("service account private_key is not RSA")
		}
		return key, nil
	}
}

func exchangeServiceAccount(ctx context.Context, client *http.Client, raw string) (string, error) {
	sa, key, err := parseServiceAccount(raw)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(raw))
	cacheKey := base64.RawURLEncoding.EncodeToString(sum[:])
	now := time.Now()
	googleTokenCache.mu.Lock()
	if item, ok := googleTokenCache.m[cacheKey]; ok && now.Before(item.until) {
		googleTokenCache.mu.Unlock()
		return item.token, nil
	}
	googleTokenCache.mu.Unlock()

	assertion, err := signServiceAccountJWT(sa, key, now)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sa.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("google auth request failed")
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("google auth returned %d", resp.StatusCode)
	}
	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if json.Unmarshal(body, &parsed) != nil || parsed.AccessToken == "" {
		return "", fmt.Errorf("google auth response had no access token")
	}
	ttl := time.Duration(parsed.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = time.Hour
	}
	if ttl > 90*time.Second {
		ttl -= 60 * time.Second
	}
	googleTokenCache.mu.Lock()
	if googleTokenCache.m == nil {
		googleTokenCache.m = map[string]cachedGoogleToken{}
	}
	googleTokenCache.m[cacheKey] = cachedGoogleToken{token: parsed.AccessToken, until: now.Add(ttl)}
	googleTokenCache.mu.Unlock()
	return parsed.AccessToken, nil
}

func signServiceAccountJWT(sa serviceAccount, key *rsa.PrivateKey, now time.Time) (string, error) {
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{
		"iss":   sa.ClientEmail,
		"sub":   sa.ClientEmail,
		"aud":   sa.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
		"scope": googleScope,
	})
	signing := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", err
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}
