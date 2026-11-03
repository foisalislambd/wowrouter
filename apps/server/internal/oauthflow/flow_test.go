package oauthflow

import (
	"strings"
	"testing"
)

func TestDeviceAndRefreshRoundTrip(t *testing.T) {
	code, err := ParseDevice([]byte(`{"device_code":"d","user_code":"ABCD-EFGH","verification_uri":"https://github.com/login/device","interval":5}`))
	if err != nil || code.UserCode != "ABCD-EFGH" {
		t.Fatal(err)
	}
	if _, err := ParseToken([]byte(`{"error":"authorization_pending"}`)); err == nil || err.Error() != "authorization_pending" {
		t.Fatal(err)
	}
	token, err := ParseToken([]byte(`{"access_token":"gho_1","refresh_token":"r","expires_in":3600}`))
	if err != nil {
		t.Fatal(err)
	}
	token.TokenURL = "https://github.com/login/oauth/access_token"
	token.ClientID = "Iv1.example"
	saved := Encode(token)
	if !strings.HasPrefix(saved, "{") {
		t.Fatal(saved)
	}
	back := Decode(saved)
	if back.AccessToken != "gho_1" || back.RefreshToken != "r" || back.ClientID != "Iv1.example" {
		t.Fatalf("%+v", back)
	}
	if Decode("plain").AccessToken != "plain" {
		t.Fatal("plain token")
	}
}

func TestPKCEURL(t *testing.T) {
	verifier, challenge, err := Verifier()
	if err != nil || len(verifier) < 32 || challenge == "" || challenge == verifier {
		t.Fatal(verifier, challenge, err)
	}
	raw, err := AuthURL("https://example.com/authorize", "client", "http://127.0.0.1:8787/api/oauth/callback", challenge, "state", "openid")
	if err != nil || !strings.Contains(raw, "code_challenge_method=S256") || !strings.Contains(raw, "client_id=client") {
		t.Fatal(raw, err)
	}
}
