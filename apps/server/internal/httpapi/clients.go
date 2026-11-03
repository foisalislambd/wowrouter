package httpapi

import "net/http"

func (s *Server) clients(w http.ResponseWriter, _ *http.Request) {
	base := "http://" + s.Addr
	api := base + "/v1"
	writeJSON(w, http.StatusOK, map[string]any{
		"baseUrl":  api,
		"panelUrl": base,
		"clients": []map[string]string{
			{
				"id":      "claude",
				"name":    "Claude Code",
				"summary": "Claude Code calls /v1/messages. The base URL is the router origin with no /v1 suffix. The router key is the auth token.",
				"config":  "ANTHROPIC_BASE_URL=" + base + "\nANTHROPIC_AUTH_TOKEN=YOUR_ROUTER_KEY\nModel: auto",
			},
			{
				"id":      "cursor",
				"name":    "Cursor",
				"summary": "Override the OpenAI base URL. Paste a router key as the OpenAI API key, then pick a model such as auto or openai/gpt-4o-mini.",
				"config":  "Base URL: " + api + "\nAPI key: YOUR_ROUTER_KEY\nModel: auto",
			},
			{
				"id":      "opencode",
				"name":    "OpenCode",
				"summary": "Add an OpenAI-compatible provider. The model id auto lets WowRouter choose among the chat models you turned on.",
				"config":  "{\n  \"provider\": {\n    \"wowrouter\": {\n      \"npm\": \"@ai-sdk/openai-compatible\",\n      \"name\": \"WowRouter\",\n      \"options\": {\n        \"baseURL\": \"" + api + "\",\n        \"apiKey\": \"YOUR_ROUTER_KEY\"\n      },\n      \"models\": {\n        \"auto\": { \"name\": \"Auto\" },\n        \"auto/coding\": { \"name\": \"Auto coding\" },\n        \"auto/cheap\": { \"name\": \"Auto cheap\" }\n      }\n    }\n  }\n}",
			},
			{
				"id":      "cline",
				"name":    "Cline and Continue",
				"summary": "Point the OpenAI-compatible provider at this router. Use the same base URL and router key.",
				"config":  "Base URL: " + api + "\nAPI key: YOUR_ROUTER_KEY\nModel: auto/coding",
			},
			{
				"id":      "env",
				"name":    "Scripts and CLIs",
				"summary": "Any tool that honors the OpenAI environment variables can use the router without a config file.",
				"config":  "OPENAI_BASE_URL=" + api + "\nOPENAI_API_KEY=YOUR_ROUTER_KEY",
			},
		},
	})
}

func (s *Server) queryModels(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authorize(w, r); !ok {
		return
	}
	var body struct {
		Profile    string `json:"profile"`
		Limit      int    `json:"limit"`
		Query      string `json:"q"`
		MinContext int    `json:"minContext"`
		Reasoning  *bool  `json:"reasoning"`
		Kind       string `json:"kind"`
	}
	if err := readJSON(r, &body); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error", "invalid_body")
		return
	}
	switch body.Profile {
	case "", "balanced", "cheap", "fast", "coding":
	default:
		writeOpenAIError(w, http.StatusBadRequest, "profile must be balanced, cheap, fast, or coding", "invalid_request_error", "invalid_profile")
		return
	}
	if body.Kind != "" && body.Kind != "chat" {
		writeJSON(w, http.StatusOK, map[string]any{"object": "list", "profile": body.Profile, "data": []any{}})
		return
	}
	items, err := s.Store.RankedChatModels(body.Profile, body.Query, body.MinContext, body.Reasoning, body.Limit)
	if err != nil {
		writeOpenAIError(w, http.StatusInternalServerError, err.Error(), "server_error", "internal_error")
		return
	}
	profile := body.Profile
	if profile == "" {
		profile = "balanced"
	}
	data := make([]map[string]any, 0, len(items))
	for _, item := range items {
		data = append(data, map[string]any{
			"id":                     item.ID,
			"object":                 "model",
			"owned_by":               item.Provider,
			"display_name":           item.DisplayName,
			"reasoning":              item.Reasoning,
			"context_window":         item.Context,
			"input_usd_per_million":  item.InputPrice,
			"output_usd_per_million": item.OutputPrice,
			"avg_latency_ms":         item.AvgLatencyMS,
			"requests":               item.Requests,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"object":  "list",
		"profile": profile,
		"summary": profileSummary(profile),
		"data":    data,
	})
}

func profileSummary(profile string) string {
	switch profile {
	case "cheap":
		return "Ordered by catalog price, then recent errors and latency."
	case "fast":
		return "Ordered by recent successful latency. Models with no history sort after measured ones."
	case "coding":
		return "Prefers reasoning models and longer context, then fewer errors and a lower price."
	default:
		return "Balances catalog price, recent latency, error rate, and context length."
	}
}
