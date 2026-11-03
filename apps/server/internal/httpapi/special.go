package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/provider/adapt"
	"airoute/server/internal/store"
)

func (s *Server) proxySpecial(w http.ResponseWriter, r *http.Request, source, keyID string, route store.Route, body []byte, started time.Time, retry bool) bool {
	var call adapt.SimpleChat
	var err error
	switch route.Protocol {
	case catalog.ProtocolOllama:
		call, err = adapt.OllamaChat(route.BaseURL, route.Model.UpstreamID, body, route.APIKey)
	case catalog.ProtocolCohere:
		call, err = adapt.CohereChat(route.BaseURL, route.Model.UpstreamID, body, route.APIKey)
	case catalog.ProtocolEmbedding:
		call = adapt.EmbeddingCall(route.BaseURL, route.Model.UpstreamID, promptText(body), route.APIKey)
	case catalog.ProtocolSearch:
		var note string
		var ok bool
		call, note, ok = adapt.SearchCall(route.Model.ProviderSlug, route.BaseURL, promptText(body), route.APIKey)
		if !ok {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "provider_setup", note, started)
			return true
		}
	default:
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "unsupported_protocol", "This provider protocol is not supported yet.", started)
		return true
	}
	if err != nil {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return true
	}
	if strings.TrimSpace(route.BaseURL) == "" {
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "base_url_required", "Set a base URL for this provider before calling it.", started)
		return true
	}
	method := http.MethodPost
	if call.Body == nil {
		method = http.MethodGet
	}
	request := providerRequest(method, call.URL, call.Header, call.Body)
	resp, err := s.OpenAI.Send(r.Context(), method, call.URL, call.Body, call.Header)
	if err != nil {
		if retry {
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
			})
			return false
		}
		if source == "playground" {
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
			})
			writePlaygroundFailure(w, http.StatusBadGateway, err.Error(), request)
			return true
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		if retry {
			_ = s.Store.AddLog(store.LogInput{
				Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
				StatusCode: http.StatusBadGateway, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: err.Error(), Request: string(request),
			})
			return false
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	if resp.StatusCode >= 400 {
		message := upstreamErrorMessage(payload)
		_ = s.Store.AddLog(store.LogInput{
			Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
			StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()), ErrorMessage: message, Request: string(request),
		})
		if retry {
			return false
		}
		if source == "playground" {
			writePlaygroundFailure(w, resp.StatusCode, message, request)
			return true
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(payload)
		return true
	}
	text := textForProtocol(route.Protocol, payload)
	s.noteAccount(route)
	_ = s.Store.AddLog(store.LogInput{
		Source: source, RouterKeyID: keyID, ModelID: route.Model.ID,
		StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds()), Request: string(request),
	})
	if source == "playground" {
		writeChatChunk(w, route.Model.ID, text, request)
		return true
	}
	writeJSON(w, http.StatusOK, openAICompletion(route.Model.ID, text, 0, 0))
	return true
}

func textForProtocol(protocol string, payload []byte) string {
	switch protocol {
	case catalog.ProtocolOllama:
		return adapt.TextFromOllama(payload)
	case catalog.ProtocolCohere:
		return adapt.TextFromCohere(payload)
	case catalog.ProtocolSearch:
		return adapt.TextFromSearch(payload)
	default:
		text := strings.TrimSpace(string(payload))
		if len(text) > 8000 {
			return text[:8000]
		}
		return text
	}
}

func promptText(body []byte) string {
	var parsed struct {
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ""
	}
	if parsed.Prompt != "" {
		return parsed.Prompt
	}
	var b strings.Builder
	for _, message := range parsed.Messages {
		if message.Role != "" && message.Role != "user" {
			continue
		}
		var text string
		if err := json.Unmarshal(message.Content, &text); err != nil {
			var parts []struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(message.Content, &parts)
			for _, part := range parts {
				text += part.Text
			}
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(text)
	}
	return b.String()
}

func (s *Server) callAudio(r *http.Request, route store.Route, prompt string) (int, []byte, json.RawMessage, error) {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "audio/mpeg, application/json")
	var endpoint string
	var body []byte
	if strings.Contains(route.BaseURL, "elevenlabs.io") {
		voice := route.Model.UpstreamID
		if voice == "" || voice == "speech" {
			voice = "21m00Tcm4TlvDq8ikWAM"
		}
		endpoint = strings.TrimRight(route.BaseURL, "/") + "/text-to-speech/" + voice
		header.Set("xi-api-key", route.APIKey)
		body, _ = json.Marshal(map[string]string{"text": prompt})
	} else {
		endpoint = strings.TrimRight(route.BaseURL, "/") + "/audio/speech"
		header.Set("Authorization", "Bearer "+route.APIKey)
		model := route.Model.UpstreamID
		if model == "" || model == "speech" {
			model = "tts-1"
		}
		body, _ = json.Marshal(map[string]string{"model": model, "input": prompt, "voice": "alloy"})
	}
	status, payload, err := s.readAudio(r, endpoint, body, header)
	return status, payload, providerRequest(http.MethodPost, endpoint, header, body), err
}

func (s *Server) readAudio(r *http.Request, endpoint string, body []byte, header http.Header) (int, []byte, error) {
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, endpoint, body, header)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return 0, nil, err
	}
	contentType := resp.Header.Get("Content-Type")
	if resp.StatusCode < 300 && strings.HasPrefix(contentType, "audio/") {
		wrapped, _ := json.Marshal(map[string]string{"audio": "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString(payload)})
		return resp.StatusCode, wrapped, nil
	}
	return resp.StatusCode, payload, nil
}

func (s *Server) callSDWebUI(r *http.Request, route store.Route, prompt string) (int, []byte, json.RawMessage, error) {
	body, _ := json.Marshal(map[string]string{"prompt": prompt})
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	endpoint := strings.TrimRight(route.BaseURL, "/") + "/sdapi/v1/txt2img"
	request := providerRequest(http.MethodPost, endpoint, header, body)
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, endpoint, body, header)
	if err != nil {
		return 0, nil, request, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return 0, nil, request, err
	}
	if resp.StatusCode >= 300 {
		return resp.StatusCode, payload, request, nil
	}
	var parsed struct {
		Images []string `json:"images"`
	}
	if err := json.Unmarshal(payload, &parsed); err != nil || len(parsed.Images) == 0 {
		return resp.StatusCode, payload, request, nil
	}
	data := make([]map[string]string, 0, len(parsed.Images))
	for _, image := range parsed.Images {
		data = append(data, map[string]string{"b64_json": image})
	}
	wrapped, _ := json.Marshal(map[string]any{"data": data})
	return resp.StatusCode, wrapped, request, nil
}

func (s *Server) callNativeMedia(r *http.Request, route store.Route, prompt string) (int, []byte, json.RawMessage, error) {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json")
	model := route.Model.UpstreamID
	endpoint := strings.TrimRight(route.BaseURL, "/")
	switch route.Model.ProviderSlug {
	case "black-forest-labs":
		if model == "" || model == "image" || model == "video" {
			model = "flux-pro-1.1"
		}
		endpoint += "/" + model
		header.Set("x-key", route.APIKey)
	case "fal-ai":
		if model == "" || model == "image" || model == "video" {
			return http.StatusBadRequest, []byte(`{"error":{"message":"Choose a fal model id."}}`), nil, nil
		}
		endpoint += "/" + strings.TrimLeft(model, "/")
		header.Set("Authorization", "Key "+route.APIKey)
	case "deepai":
		header.Set("api-key", route.APIKey)
		if model == "" || model == "image" {
			endpoint += "/text2img"
		} else {
			endpoint += "/" + model
		}
	default:
		if route.APIKey != "" {
			header.Set("Authorization", "Bearer "+route.APIKey)
		}
		if model != "" && model != "image" && model != "video" && !strings.Contains(endpoint, model) {
			endpoint += "/" + model
		}
	}
	body, _ := json.Marshal(map[string]string{"prompt": prompt, "model": model})
	request := providerRequest(http.MethodPost, endpoint, header, body)
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, endpoint, body, header)
	if err != nil {
		return 0, nil, request, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return 0, nil, request, err
	}
	return resp.StatusCode, payload, request, nil
}
