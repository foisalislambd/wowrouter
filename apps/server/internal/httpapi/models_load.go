package httpapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"airoute/server/internal/catalog"
	"airoute/server/internal/provider/openai"
	"airoute/server/internal/store"
)

func (s *Server) loadProviderModels(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var body struct {
		APIKey  *string `json:"apiKey"`
		BaseURL *string `json:"baseUrl"`
	}
	if err := readJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	baseURL, apiKey, protocol, _, err := s.Store.ProviderSecret(slug)
	if errors.Is(err, store.ErrNotFound) {
		writeAPIError(w, http.StatusNotFound, "provider not found")
		return
	}
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body.BaseURL != nil && strings.TrimSpace(*body.BaseURL) != "" {
		if err := validateBaseURL(*body.BaseURL); err != nil {
			writeAPIError(w, http.StatusBadRequest, err.Error())
			return
		}
		baseURL = strings.TrimRight(strings.TrimSpace(*body.BaseURL), "/")
	}
	if body.APIKey != nil && strings.TrimSpace(*body.APIKey) != "" {
		apiKey = strings.TrimSpace(*body.APIKey)
	}
	apiKey = providerCredential(slug, apiKey)
	def, known := catalog.BySlug(slug)
	if apiKey == "" && (!known || !def.KeyOptional) {
		writeAPIError(w, http.StatusBadRequest, credentialMissingMessage(slug))
		return
	}
	if strings.TrimSpace(baseURL) == "" {
		writeAPIError(w, http.StatusBadRequest, "set a base URL before loading models")
		return
	}
	endpoint, header, err := modelListCall(protocol, baseURL, apiKey, catalog.UsesSessionCookie(slug))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	listed, err := s.collectModelIDs(ctx, endpoint, header)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	if len(listed) == 0 {
		writeAPIError(w, http.StatusBadGateway, "the provider returned no models")
		return
	}
	count, err := s.Store.ReplaceLoadedModels(slug, listedModels(listed))
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": count})
}

func listedModels(items []openai.ListedModel) []store.LoadedModel {
	loaded := make([]store.LoadedModel, len(items))
	for i, item := range items {
		loaded[i] = store.LoadedModel{
			UpstreamID:          item.ID,
			Inputs:              catalog.NormalizeModalities(item.Inputs),
			Outputs:             catalog.NormalizeModalities(item.Outputs),
			ContextWindow:       item.ContextWindow,
			MaxOutput:           item.MaxOutput,
			InputUSDPerMillion:  item.InputUSDPerMillion,
			OutputUSDPerMillion: item.OutputUSDPerMillion,
		}
	}
	return loaded
}

func (s *Server) collectModelIDs(ctx context.Context, endpoint string, header http.Header) ([]openai.ListedModel, error) {
	seen := map[string]struct{}{}
	var listed []openai.ListedModel
	next := endpoint
	previous := ""
	for page := 0; page < 40; page++ {
		resp, err := s.OpenAI.Send(ctx, http.MethodGet, next, nil, header)
		if err != nil {
			return nil, err
		}
		payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			message := strings.TrimSpace(string(payload))
			if len(message) > 280 {
				message = message[:280]
			}
			if message == "" {
				message = resp.Status
			}
			return nil, errors.New("provider returned " + resp.Status + ": " + message)
		}
		parsed := openai.ParseModelListPage(payload)
		added := 0
		for _, item := range parsed.Models {
			if _, ok := seen[item.ID]; ok {
				continue
			}
			seen[item.ID] = struct{}{}
			listed = append(listed, item)
			added++
		}
		cursor := parsed.NextPageToken
		if cursor == "" && parsed.HasMore {
			cursor = parsed.LastID
		}
		if cursor == "" || cursor == previous || added == 0 {
			break
		}
		previous = cursor
		if parsed.NextPageToken != "" {
			next = withQuery(endpoint, "pageToken", parsed.NextPageToken)
			continue
		}
		next = withQuery(withQuery(endpoint, "limit", "100"), "after_id", parsed.LastID)
	}
	return listed, nil
}

func withQuery(raw, key, value string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	query := parsed.Query()
	query.Set(key, value)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func credentialMissingMessage(slug string) string {
	if catalog.UsesSessionCookie(slug) {
		return "paste a session cookie first"
	}
	return "add an API key first"
}

func modelListCall(protocol, baseURL, apiKey string, cookie bool) (string, http.Header, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	header := http.Header{}
	header.Set("Accept", "application/json")
	switch protocol {
	case catalog.ProtocolOpenAIChat:
		openai.ApplyCredential(header, apiKey, cookie)
		return base + "/models", header, nil
	case catalog.ProtocolAnthropic:
		header.Set("anthropic-version", "2023-06-01")
		if cookie {
			openai.ApplyCredential(header, apiKey, true)
		} else {
			header.Set("x-api-key", apiKey)
			if apiKey != "" {
				header.Set("Authorization", "Bearer "+apiKey)
			}
		}
		base = strings.TrimSuffix(base, "/messages")
		if strings.HasSuffix(base, "/v1") {
			return base + "/models", header, nil
		}
		return base + "/v1/models", header, nil
	case catalog.ProtocolGemini:
		base = strings.TrimSuffix(base, "/openai")
		if apiKey != "" {
			header.Set("x-goog-api-key", apiKey)
		}
		return base + "/models", header, nil
	case catalog.ProtocolOllama:
		if apiKey != "" {
			header.Set("Authorization", "Bearer "+apiKey)
		}
		if strings.HasSuffix(base, "/api") {
			return base + "/tags", header, nil
		}
		return base + "/api/tags", header, nil
	case catalog.ProtocolCohere:
		if apiKey != "" {
			header.Set("Authorization", "Bearer "+apiKey)
		}
		base = strings.TrimSuffix(base, "/v2")
		base = strings.TrimSuffix(base, "/v1")
		return base + "/v1/models", header, nil
	default:
		return "", nil, errors.New("this provider does not publish a model list this router can load")
	}
}
