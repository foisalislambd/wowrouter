package gateway

import "strings"

// JoinUpstream appends an API path to a provider base without repeating a
// prefix the base already includes. Anthropic bases that end in /v1 stay on
// /v1/messages, and a Gemini base that already ends in /models is not doubled.
func JoinUpstream(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if path == "" {
		return base
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	switch {
	case strings.HasSuffix(base, "/v1") && strings.HasPrefix(path, "/v1/"):
		path = strings.TrimPrefix(path, "/v1")
	case strings.HasSuffix(base, "/models") && strings.HasPrefix(path, "/models/"):
		path = strings.TrimPrefix(path, "/models")
	case strings.HasSuffix(base, "/chat/completions") && strings.HasSuffix(path, "/chat/completions"):
		return base
	}
	return base + path
}
