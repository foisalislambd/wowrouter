package gateway

import "testing"

func TestJoinUpstreamDoesNotDoublePrefixes(t *testing.T) {
	cases := []struct{ base, path, want string }{
		{"https://api.anthropic.com", "/v1/messages", "https://api.anthropic.com/v1/messages"},
		{"https://api.anthropic.com/v1", "/v1/messages", "https://api.anthropic.com/v1/messages"},
		{"https://api.anthropic.com/v1/", "/v1/messages", "https://api.anthropic.com/v1/messages"},
		{"https://generativelanguage.googleapis.com/v1beta", "/models/gemini-2.0:generateContent", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:generateContent"},
		{"https://generativelanguage.googleapis.com/v1beta/models", "/models/gemini-2.0:generateContent", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:generateContent"},
		{"https://api.openai.com/v1", "/chat/completions", "https://api.openai.com/v1/chat/completions"},
		{"https://api.openai.com/v1/chat/completions", "/chat/completions", "https://api.openai.com/v1/chat/completions"},
	}
	for _, tc := range cases {
		if got := JoinUpstream(tc.base, tc.path); got != tc.want {
			t.Fatalf("%s + %s = %s, want %s", tc.base, tc.path, got, tc.want)
		}
	}
}
