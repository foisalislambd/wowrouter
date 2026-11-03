package adapt

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"airoute/server/internal/awsig"
	"airoute/server/internal/oauthflow"
)

// Prepared is one upstream call built from an OpenAI chat body.
type Prepared struct {
	Method string
	URL    string
	Header http.Header
	Body   []byte
	Sign   *awsig.Credentials
	Wrap   bool
}

func chatMeta(body []byte) (model, prompt string, messages json.RawMessage, stream bool) {
	var parsed struct {
		Model    string          `json:"model"`
		Messages json.RawMessage `json:"messages"`
		Stream   bool            `json:"stream"`
	}
	_ = json.Unmarshal(body, &parsed)
	model = parsed.Model
	messages = parsed.Messages
	stream = parsed.Stream
	var items []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	_ = json.Unmarshal(parsed.Messages, &items)
	for i := len(items) - 1; i >= 0; i-- {
		if strings.TrimSpace(items[i].Content) != "" {
			prompt = items[i].Content
			break
		}
	}
	return model, prompt, messages, stream
}

// GitLab turns a chat into a Duo code-suggestions call.
func GitLab(base, token string, body []byte) Prepared {
	_, prompt, _, stream := chatMeta(body)
	payload, _ := json.Marshal(map[string]any{
		"current_file": map[string]string{
			"file_name":            "wowrouter.txt",
			"content_above_cursor": prompt,
			"content_below_cursor": "",
		},
		"intent":           "generation",
		"user_instruction": prompt,
		"stream":           stream,
	})
	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json, text/event-stream")
	return Prepared{Method: http.MethodPost, URL: strings.TrimRight(base, "/") + "/code_suggestions/completions", Header: header, Body: payload, Wrap: true}
}

// Bedrock signs an OpenAI chat body for the Bedrock runtime.
func Bedrock(base, secret string, body []byte) (Prepared, error) {
	parsed, err := url.Parse(strings.TrimRight(base, "/") + "/chat/completions")
	if err != nil {
		return Prepared{}, err
	}
	region := awsig.RegionFromHost(parsed.Host)
	cred, ok := awsig.Parse(secret, region)
	if !ok {
		return Prepared{}, errString("save the Bedrock key as accessKeyId:secretAccessKey")
	}
	model, _, _, _ := chatMeta(body)
	upstream, err := rewriteModel(body, model)
	if err != nil {
		return Prepared{}, err
	}
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json, text/event-stream")
	return Prepared{Method: http.MethodPost, URL: parsed.String(), Header: header, Body: upstream, Sign: &cred}, nil
}

// SAP exchanges a service-key JSON for a bearer token, then calls the deployment.
func SAP(base, secret string, body []byte) (Prepared, string, error) {
	var key struct {
		ClientID     string `json:"clientid"`
		ClientSecret string `json:"clientsecret"`
		URL          string `json:"url"`
		ServiceURLs  struct {
			AI string `json:"AI_API_URL"`
		} `json:"serviceurls"`
	}
	if json.Unmarshal([]byte(secret), &key) != nil || key.ClientID == "" || key.ClientSecret == "" || key.URL == "" {
		return Prepared{}, "", errString("paste the SAP AI Core service key JSON")
	}
	tokenURL := strings.TrimRight(key.URL, "/") + "/oauth/token"
	target := strings.TrimRight(base, "/")
	if target == "" {
		target = strings.TrimRight(key.ServiceURLs.AI, "/")
	}
	if target == "" {
		return Prepared{}, "", errString("set the deployment base URL")
	}
	if !strings.Contains(target, "/chat/completions") {
		target += "/chat/completions"
	}
	model, _, _, _ := chatMeta(body)
	upstream, err := rewriteModel(body, model)
	if err != nil {
		return Prepared{}, "", err
	}
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json, text/event-stream")
	header.Set("AI-Resource-Group", "default")
	return Prepared{Method: http.MethodPost, URL: target, Header: header, Body: upstream}, tokenURL + "\n" + key.ClientID + "\n" + key.ClientSecret, nil
}

// Clova builds a v3 chat-completions call. The reply is often an event stream.
func Clova(base, token string, body []byte) Prepared {
	model, _, messages, _ := chatMeta(body)
	model = lastPath(model)
	payload, _ := json.Marshal(map[string]any{"messages": json.RawMessage(emptyMessages(messages)), "maxTokens": 1024})
	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "text/event-stream, application/json")
	return Prepared{
		Method: http.MethodPost,
		URL:    strings.TrimRight(base, "/") + "/chat-completions/" + url.PathEscape(model),
		Header: header, Body: payload, Wrap: true,
	}
}

// Agent opens a cloud coding session.
func Agent(slug, base, token, prompt string) Prepared {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json")
	switch slug {
	case "jules":
		header.Set("x-goog-api-key", token)
		payload, _ := json.Marshal(map[string]string{"prompt": prompt})
		return Prepared{Method: http.MethodPost, URL: strings.TrimRight(base, "/") + "/v1alpha/sessions", Header: header, Body: payload, Wrap: true}
	default:
		header.Set("Authorization", "Bearer "+token)
		payload, _ := json.Marshal(map[string]string{"prompt": prompt})
		return Prepared{Method: http.MethodPost, URL: strings.TrimRight(base, "/") + "/v1/sessions", Header: header, Body: payload, Wrap: true}
	}
}

// Comfy queues a workflow. A JSON object is sent as the graph. Plain text fills a one-node prompt.
func Comfy(base, prompt string) Prepared {
	var graph any
	if json.Unmarshal([]byte(strings.TrimSpace(prompt)), &graph) != nil || graph == nil {
		graph = map[string]any{
			"1": map[string]any{
				"class_type": "CLIPTextEncode",
				"inputs":     map[string]any{"text": prompt},
			},
		}
	}
	payload, _ := json.Marshal(map[string]any{"prompt": graph})
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	return Prepared{Method: http.MethodPost, URL: strings.TrimRight(base, "/") + "/prompt", Header: header, Body: payload, Wrap: true}
}

// DuckStatus is the anonymous handshake.
func DuckStatus(base string) (string, http.Header) {
	header := http.Header{}
	header.Set("x-vqd-accept", "1")
	header.Set("Accept", "application/json")
	return strings.TrimRight(base, "/") + "/status", header
}

// DuckChat posts the OpenAI body with the vqd token from the handshake.
func DuckChat(base, vqd string, body []byte) Prepared {
	model, _, _, _ := chatMeta(body)
	upstream, _ := rewriteModel(body, model)
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "text/event-stream, application/json")
	header.Set("x-vqd-4", vqd)
	return Prepared{Method: http.MethodPost, URL: strings.TrimRight(base, "/") + "/chat", Header: header, Body: upstream, Wrap: true}
}

// OAuthChat sends the saved access token to the enterprise Copilot chat route.
func OAuthChat(base, saved string, body []byte) Prepared {
	token := oauthflow.Decode(saved)
	model, _, _, _ := chatMeta(body)
	upstream, _ := rewriteModel(body, model)
	header := http.Header{}
	header.Set("Authorization", "Bearer "+token.AccessToken)
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json, text/event-stream")
	return Prepared{Method: http.MethodPost, URL: strings.TrimRight(base, "/") + "/api/copilot/chat/completions", Header: header, Body: upstream}
}

// SessionChat sends a pasted bearer token to the provider chat path.
func SessionChat(base, token string, body []byte) Prepared {
	model, _, _, _ := chatMeta(body)
	upstream, _ := rewriteModel(body, model)
	header := http.Header{}
	header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json, text/event-stream")
	endpoint := strings.TrimRight(base, "/")
	if !strings.HasSuffix(endpoint, "/chat") {
		endpoint += "/chat"
	}
	return Prepared{Method: http.MethodPost, URL: endpoint, Header: header, Body: upstream, Wrap: true}
}

// Text reads a useful assistant string from several response shapes.
func Text(payload []byte) string {
	text := firstJSONText(payload)
	if text != "" {
		return text
	}
	var b strings.Builder
	for _, line := range strings.Split(string(payload), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
		if line == "" || line == "[DONE]" {
			continue
		}
		if piece := firstJSONText([]byte(line)); piece != "" {
			b.WriteString(piece)
		}
	}
	return b.String()
}

func firstJSONText(payload []byte) string {
	var parsed struct {
		Choices []struct {
			Text    string `json:"text"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Message json.RawMessage `json:"message"`
		Text    string          `json:"text"`
		URL     string          `json:"url"`
		Name    string          `json:"name"`
		ID      string          `json:"id"`
		Prompt  string          `json:"prompt_id"`
		Output  string          `json:"output"`
	}
	if json.Unmarshal(payload, &parsed) != nil {
		return ""
	}
	if len(parsed.Choices) > 0 {
		if parsed.Choices[0].Message.Content != "" {
			return parsed.Choices[0].Message.Content
		}
		if parsed.Choices[0].Text != "" {
			return parsed.Choices[0].Text
		}
	}
	if msg := messageText(parsed.Message); msg != "" {
		return msg
	}
	if parsed.Text != "" {
		return parsed.Text
	}
	if parsed.URL != "" {
		return parsed.URL
	}
	if parsed.Name != "" && strings.Contains(parsed.Name, "sessions/") {
		return parsed.Name
	}
	if parsed.Prompt != "" {
		return "queued " + parsed.Prompt
	}
	if parsed.Output != "" {
		return parsed.Output
	}
	return ""
}

func messageText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var object struct {
		Content string `json:"content"`
	}
	if json.Unmarshal(raw, &object) == nil {
		return object.Content
	}
	return ""
}

func rewriteModel(body []byte, model string) ([]byte, error) {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if model != "" {
		parsed["model"] = lastPath(model)
	}
	return json.Marshal(parsed)
}

func lastPath(model string) string {
	model = strings.TrimSpace(model)
	if i := strings.LastIndex(model, "/"); i >= 0 {
		return model[i+1:]
	}
	return model
}

func emptyMessages(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`[]`)
	}
	return raw
}

type errString string

func (e errString) Error() string { return string(e) }
