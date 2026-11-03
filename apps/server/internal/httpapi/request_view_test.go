package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestProviderRequestRedactsSecrets(t *testing.T) {
	header := http.Header{}
	header.Set("Authorization", "Bearer sk-test-secret-1234")
	header.Set("Content-Type", "application/json")
	header.Set("x-api-key", "abcd1234wxyz")
	body := []byte(`{"model":"gpt","messages":[{"content":"data:image/png;base64,` + strings.Repeat("a", 200) + `"}]}`)
	raw := providerRequest(http.MethodPost, "https://api.example/v1/chat/completions", header, body)
	text := string(raw)
	if strings.Contains(text, "sk-test-secret") || strings.Contains(text, "abcd1234wxyz") {
		t.Fatalf("secret leaked: %s", text)
	}
	var parsed struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    struct {
			Model string `json:"model"`
		} `json:"body"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Method != http.MethodPost || parsed.URL == "" || parsed.Body.Model != "gpt" {
		t.Fatalf("request view: %+v", parsed)
	}
	if parsed.Headers["Content-Type"] != "application/json" {
		t.Fatalf("content type: %v", parsed.Headers)
	}
	if !strings.HasPrefix(parsed.Headers["Authorization"], "Bearer ••••") || !strings.HasSuffix(parsed.Headers["Authorization"], "1234") {
		t.Fatalf("authorization: %s", parsed.Headers["Authorization"])
	}
	if !strings.Contains(text, "chars)") {
		t.Fatalf("data url was not shortened: %s", text)
	}
}
