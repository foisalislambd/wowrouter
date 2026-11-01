// Package clients prints the one-command config for local coding tools.
package clients

import "strings"

// Names are the tools configure knows about.
func Names() []string {
	return []string{"claude", "codex", "cursor", "cline", "opencode", "copilot"}
}

// Snippet is the file a tool reads so it talks to this gateway.
func Snippet(name, baseURL, apiKey string) (filename, body string, ok bool) {
	name = strings.ToLower(strings.TrimSpace(name))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8787"
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if apiKey == "" {
		apiKey = "sk-wowrouter-YOUR-KEY"
	}
	switch name {
	case "claude", "claude-code":
		return "claude-settings.json", `{
  "env": {
    "ANTHROPIC_BASE_URL": "` + baseURL + `",
    "ANTHROPIC_AUTH_TOKEN": "` + apiKey + `"
  }
}
`, true
	case "codex":
		return "codex-config.toml", `model_provider = "wowrouter"
model = "auto/coding"

[model_providers.wowrouter]
name = "WowRouter"
base_url = "` + baseURL + `/v1"
wire_api = "responses"
env_key = "WOWROUTER_API_KEY"
`, true
	case "cursor":
		return "cursor-openai.json", `{
  "openaiBaseUrl": "` + baseURL + `/v1",
  "openaiApiKey": "` + apiKey + `",
  "model": "auto/coding"
}
`, true
	case "cline":
		return "cline-settings.json", `{
  "apiProvider": "openai",
  "openAiBaseUrl": "` + baseURL + `/v1",
  "openAiApiKey": "` + apiKey + `",
  "openAiModelId": "auto/coding"
}
`, true
	case "opencode":
		return "opencode.json", `{
  "provider": {
    "wowrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "` + baseURL + `/v1", "apiKey": "` + apiKey + `" },
      "models": { "auto/coding": { "name": "auto/coding" } }
    }
  }
}
`, true
	case "copilot":
		return "copilot-chat.json", `{
  "github.copilot.chat.byok.ollamaEndpoint": "` + baseURL + `/v1",
  "wowrouter.baseUrl": "` + baseURL + `/v1",
  "wowrouter.apiKey": "` + apiKey + `",
  "wowrouter.model": "auto/coding"
}
`, true
	default:
		return "", "", false
	}
}
