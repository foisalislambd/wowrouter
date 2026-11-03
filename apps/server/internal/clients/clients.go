// Package clients prints the one-command config for local coding tools.
package clients

import (
	"encoding/json"
	"strings"
)

// Names are the tools configure knows about.
func Names() []string {
	return []string{"claude", "codex", "cursor", "cline", "opencode", "copilot"}
}

// Snippet is the file a tool reads so it talks to this gateway.
// JSON snippets stay valid when the key or URL contains quotes.
func Snippet(name, baseURL, apiKey string) (filename, body string, ok bool) {
	name = strings.ToLower(strings.TrimSpace(name))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8787"
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if apiKey == "" {
		apiKey = "sk-wowrouter-YOUR-KEY"
	}
	v1 := baseURL + "/v1"
	switch name {
	case "claude", "claude-code":
		return "claude-settings.json", mustJSON(map[string]any{
			"env": map[string]any{
				"ANTHROPIC_BASE_URL":   baseURL,
				"ANTHROPIC_AUTH_TOKEN": apiKey,
			},
		}), true
	case "codex":
		return "codex-config.toml", "model_provider = \"wowrouter\"\nmodel = \"auto/coding\"\n\n[model_providers.wowrouter]\nname = \"WowRouter\"\nbase_url = \"" + tomlEscape(v1) + "\"\nwire_api = \"responses\"\nenv_key = \"WOWROUTER_API_KEY\"\n", true
	case "cursor":
		return "cursor-openai.json", mustJSON(map[string]any{
			"openaiBaseUrl": v1,
			"openaiApiKey":  apiKey,
			"model":         "auto/coding",
		}), true
	case "cline":
		return "cline-settings.json", mustJSON(map[string]any{
			"apiProvider":   "openai",
			"openAiBaseUrl": v1,
			"openAiApiKey":  apiKey,
			"openAiModelId": "auto/coding",
		}), true
	case "opencode":
		return "opencode.json", mustJSON(map[string]any{
			"provider": map[string]any{
				"wowrouter": map[string]any{
					"npm": "@ai-sdk/openai-compatible",
					"options": map[string]any{
						"baseURL": v1,
						"apiKey":  apiKey,
					},
					"models": map[string]any{
						"auto/coding": map[string]any{"name": "auto/coding"},
					},
				},
			},
		}), true
	case "copilot":
		return "copilot-chat.json", mustJSON(map[string]any{
			"github.copilot.chat.byok.ollamaEndpoint": v1,
			"wowrouter.baseUrl":                       v1,
			"wowrouter.apiKey":                        apiKey,
			"wowrouter.model":                         "auto/coding",
		}), true
	default:
		return "", "", false
	}
}

func mustJSON(v any) string {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "{}\n"
	}
	return string(raw) + "\n"
}

func tomlEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(s)
}
