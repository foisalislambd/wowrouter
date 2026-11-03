package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"airoute/server/internal/catalog"
	"airoute/server/internal/store"
)

func (s *Server) gatewayDecision(w http.ResponseWriter, r *http.Request) {
	keyID, ok := s.authorize(w, r)
	if !ok {
		return
	}
	s.serveDecision(w, r, "gateway", keyID)
}

func (s *Server) playgroundDecision(w http.ResponseWriter, r *http.Request) {
	s.serveDecision(w, r, "playground", "")
}

func (s *Server) serveDecision(w http.ResponseWriter, r *http.Request, source, keyID string) {
	started := time.Now()
	body, err := readBody(r, 2<<20)
	if err != nil {
		s.failChat(w, source, keyID, "", http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return
	}
	var meta struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &meta); err != nil || strings.TrimSpace(meta.Model) == "" {
		s.failChat(w, source, keyID, meta.Model, http.StatusBadRequest, "invalid_request_error", "model_required", "The model field is required.", started)
		return
	}
	route, err := s.Store.ResolveRoute(meta.Model)
	if err != nil {
		s.failChat(w, source, keyID, meta.Model, http.StatusNotFound, "invalid_request_error", "model_not_found", "The model `"+meta.Model+"` does not exist.", started)
		return
	}
	if route.Model.Kind != catalog.KindDecision && route.Protocol != catalog.ProtocolSystemOne {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", "This model is not a decision model.", started)
		return
	}
	parts, err := s.Store.ExpandAccounts(route)
	if err != nil {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusInternalServerError, "server_error", "internal_error", err.Error(), started)
		return
	}
	for i, part := range parts {
		part.APIKey = providerCredential(part.Model.ProviderSlug, part.APIKey)
		last := i == len(parts)-1
		if !routeReady(part) {
			if last {
				s.failChat(w, source, keyID, part.Model.ID, http.StatusNotFound, "invalid_request_error", "model_not_found", routeBlockedMessage(meta.Model, part), started)
				return
			}
			continue
		}
		if s.proxyDecision(w, r, source, keyID, part, body, started, !last) {
			return
		}
	}
}

func (s *Server) proxyDecision(w http.ResponseWriter, r *http.Request, source, keyID string, route store.Route, body []byte, started time.Time, retry bool) bool {
	if strings.TrimSpace(route.BaseURL) == "" {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "base_url_required", "Set a base URL for this provider before calling it.", started)
		return true
	}
	upstreamBody, err := rewriteDecisionModel(body, route.Model.UpstreamID)
	if err != nil {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return true
	}

	var endpoint string
	var payload []byte
	var letters map[string]string
	if isTevModel(route.Model.UpstreamID) {
		payload, letters, err = tevChatBody(route.Model.UpstreamID, upstreamBody)
		if err != nil {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
			return true
		}
		endpoint = strings.TrimRight(route.BaseURL, "/") + "/chat/completions"
	} else {
		payload = upstreamBody
		endpoint = systemOneEndpoint(route.BaseURL, route.Model.ProviderSlug)
	}

	header := make(http.Header)
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json")
	if route.APIKey != "" {
		header.Set("Authorization", "Bearer "+route.APIKey)
	}
	request := providerRequest(http.MethodPost, endpoint, header, payload)
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, endpoint, payload, header)
	if err != nil {
		if retry {
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
			})
			return false
		}
		s.failDecision(w, source, keyID, route.Model.ID, http.StatusBadGateway, err.Error(), request, started)
		return true
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		if retry {
			return false
		}
		s.failDecision(w, source, keyID, route.Model.ID, http.StatusBadGateway, err.Error(), request, started)
		return true
	}
	if resp.StatusCode >= 400 {
		if retry {
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: upstreamErrorMessage(raw), Request: string(request),
			})
			return false
		}
		s.failDecision(w, source, keyID, route.Model.ID, resp.StatusCode, upstreamErrorMessage(raw), request, started)
		return true
	}
	if !json.Valid(raw) {
		if retry {
			return false
		}
		s.failDecision(w, source, keyID, route.Model.ID, http.StatusBadGateway, "The provider returned a decision that is not JSON.", request, started)
		return true
	}

	out := raw
	prompt, completion := decisionUsage(raw)
	if letters != nil {
		out, prompt, completion = tevAnswer(raw, letters)
	}
	s.noteAccount(route)
	_ = s.Store.AddLog(store.LogInput{
		Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
		StatusCode: http.StatusOK, LatencyMS: int(time.Since(started).Milliseconds()),
		PromptTokens: prompt, CompletionTokens: completion, Request: string(request),
	})
	if source == "playground" {
		writeJSON(w, http.StatusOK, map[string]any{
			"response": json.RawMessage(out),
			"request":  json.RawMessage(request),
		})
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
	return true
}

func (s *Server) failDecision(w http.ResponseWriter, source, keyID, modelID string, status int, message string, request []byte, started time.Time) {
	_ = s.Store.AddLog(store.LogInput{
		Source: source, RouterKeyID: keyID, ModelID: modelID,
		StatusCode: status, LatencyMS: int(time.Since(started).Milliseconds()),
		ErrorMessage: message, Request: string(request),
	})
	if source == "playground" {
		writePlaygroundFailure(w, status, message, request)
		return
	}
	kind, code := "server_error", "upstream_error"
	if status == http.StatusUnauthorized {
		kind, code = "authentication_error", "invalid_api_key"
	} else if status >= 400 && status < 500 {
		kind = "invalid_request_error"
	}
	writeOpenAIError(w, status, message, kind, code)
}

func systemOneEndpoint(baseURL, slug string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(base, "/systemone") {
		return base
	}
	if slug == "upstage" {
		base = strings.TrimSuffix(base, "/solar")
	}
	return base + "/systemone"
}

func isTevModel(upstreamID string) bool {
	return strings.Contains(strings.ToLower(upstreamID), "tev1")
}

func rewriteDecisionModel(body []byte, upstreamID string) ([]byte, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if len(payload["state"]) == 0 || string(payload["state"]) == "null" {
		return nil, errDecisionState
	}
	var questions map[string]json.RawMessage
	if err := json.Unmarshal(payload["questions"], &questions); err != nil || len(questions) == 0 {
		return nil, errDecisionQuestions
	}
	encoded, err := json.Marshal(upstreamID)
	if err != nil {
		return nil, err
	}
	payload["model"] = encoded
	return json.Marshal(payload)
}

var (
	errDecisionState     = decisionError("state is required")
	errDecisionQuestions = decisionError("questions must contain at least one question")
)

type decisionError string

func (e decisionError) Error() string { return string(e) }

func tevChatBody(upstreamID string, body []byte) ([]byte, map[string]string, error) {
	var payload struct {
		State     json.RawMessage            `json:"state"`
		Questions map[string]json.RawMessage `json:"questions"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, nil, err
	}
	if len(payload.Questions) != 1 {
		return nil, nil, decisionError("Tev answers one question per request")
	}
	questionID, question, err := firstQuestion(payload.Questions)
	if err != nil {
		return nil, nil, err
	}
	letters, options, err := tevOptions(question)
	if err != nil {
		return nil, nil, err
	}
	decision, err := json.Marshal(map[string]any{
		"state":    json.RawMessage(payload.State),
		"question": question.Instructions,
		"options":  options,
	})
	if err != nil {
		return nil, nil, err
	}
	chat, err := json.Marshal(map[string]any{
		"model":       upstreamID,
		"temperature": 0,
		"max_tokens":  8,
		"messages": []map[string]string{
			{"role": "system", "content": "Choose exactly one option. Reply with only its letter."},
			{"role": "user", "content": string(decision)},
		},
	})
	if err != nil {
		return nil, nil, err
	}
	letters["__question"] = questionID
	letters["__type"] = question.Type
	return chat, letters, nil
}

type tevQuestion struct {
	Type         string          `json:"type"`
	Instructions string          `json:"instructions"`
	Criteria     json.RawMessage `json:"criteria"`
}

func firstQuestion(questions map[string]json.RawMessage) (string, tevQuestion, error) {
	var id string
	var raw json.RawMessage
	for key, value := range questions {
		id, raw = key, value
		break
	}
	if id == "" {
		return "", tevQuestion{}, errDecisionQuestions
	}
	var question tevQuestion
	if err := json.Unmarshal(raw, &question); err != nil {
		return "", tevQuestion{}, err
	}
	if strings.TrimSpace(question.Instructions) == "" {
		return "", tevQuestion{}, decisionError("each question needs instructions")
	}
	return id, question, nil
}

func tevOptions(question tevQuestion) (map[string]string, map[string]string, error) {
	letters := map[string]string{}
	options := map[string]string{}
	seen := map[string]bool{}
	add := func(name, detail string) error {
		name = strings.TrimSpace(name)
		if name == "" {
			return decisionError("option names must not be empty")
		}
		if seen[name] {
			return decisionError("option names must be unique")
		}
		if len(letters) >= 24 {
			return decisionError("Tev accepts at most 24 options")
		}
		seen[name] = true
		letter := string(rune('A' + len(letters)))
		if strings.TrimSpace(detail) == "" {
			detail = name
		}
		letters[letter] = name
		options[letter] = detail
		return nil
	}
	switch question.Type {
	case "choice":
		var criteria map[string]json.RawMessage
		if err := json.Unmarshal(question.Criteria, &criteria); err != nil || len(criteria) < 2 {
			return nil, nil, decisionError("a choice question needs at least two options")
		}
		if len(criteria) > 24 {
			return nil, nil, decisionError("Tev accepts at most 24 options")
		}
		names := make([]string, 0, len(criteria))
		for name := range criteria {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			if err := add(name, jsonText(criteria[name])); err != nil {
				return nil, nil, err
			}
		}
	case "noul":
		if err := add("yes", "yes"); err != nil {
			return nil, nil, err
		}
		if err := add("no", "no"); err != nil {
			return nil, nil, err
		}
	case "score":
		var levels []json.RawMessage
		if err := json.Unmarshal(question.Criteria, &levels); err != nil || len(levels) < 2 {
			return nil, nil, decisionError("a score question needs at least two levels")
		}
		if len(levels) > 24 {
			return nil, nil, decisionError("Tev accepts at most 24 options")
		}
		for _, level := range levels {
			text := jsonText(level)
			if err := add(text, text); err != nil {
				return nil, nil, err
			}
		}
	default:
		return nil, nil, decisionError("question type must be noul, choice, or score")
	}
	if len(options) < 2 {
		return nil, nil, decisionError("Tev needs between 2 and 24 options")
	}
	return letters, options, nil
}

func jsonText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	return strings.Trim(string(raw), `"`)
}

func tevAnswer(raw []byte, letters map[string]string) ([]byte, int, int) {
	var chat struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
		Model string `json:"model"`
	}
	_ = json.Unmarshal(raw, &chat)
	content := ""
	if len(chat.Choices) > 0 {
		content = chat.Choices[0].Message.Content
	}
	letter := optionLetter(content, letters)
	questionID := letters["__question"]
	choice := letters[letter]
	answerType := letters["__type"]
	if answerType == "" {
		answerType = "choice"
	}
	answer := map[string]any{
		"type":   answerType,
		"letter": letter,
		"choice": choice,
	}
	body, err := json.Marshal(map[string]any{
		"model": chat.Model,
		"answers": map[string]any{
			questionID: answer,
		},
		"usage": map[string]int{
			"input_tokens":  chat.Usage.PromptTokens,
			"output_tokens": chat.Usage.CompletionTokens,
		},
	})
	if err != nil {
		return raw, chat.Usage.PromptTokens, chat.Usage.CompletionTokens
	}
	return body, chat.Usage.PromptTokens, chat.Usage.CompletionTokens
}

func optionLetter(value string, letters map[string]string) string {
	var found string
	for _, field := range strings.FieldsFunc(value, func(r rune) bool {
		return !unicode.IsLetter(r)
	}) {
		if len([]rune(field)) != 1 {
			continue
		}
		letter := strings.ToUpper(field)
		if _, ok := letters[letter]; !ok {
			continue
		}
		if found != "" && found != letter {
			return ""
		}
		found = letter
	}
	return found
}

func decisionUsage(raw []byte) (int, int) {
	var payload struct {
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	_ = json.Unmarshal(raw, &payload)
	return payload.Usage.InputTokens, payload.Usage.OutputTokens
}
