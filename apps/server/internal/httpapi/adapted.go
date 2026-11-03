package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"airoute/server/internal/awsig"
	"airoute/server/internal/catalog"
	"airoute/server/internal/oauthflow"
	"airoute/server/internal/provider/adapt"
	"airoute/server/internal/store"
)

func (s *Server) dispatchChat(w http.ResponseWriter, r *http.Request, source, keyID string, route store.Route, body []byte, started time.Time, retry bool) bool {
	switch route.Protocol {
	case catalog.ProtocolAnthropic, catalog.ProtocolGemini:
		return s.proxyNativeChat(w, r, source, keyID, route, body, started, retry)
	case catalog.ProtocolOllama, catalog.ProtocolCohere, catalog.ProtocolSearch, catalog.ProtocolEmbedding:
		return s.proxySpecial(w, r, source, keyID, route, body, started, retry)
	case catalog.ProtocolOpenAIChat:
		if route.Model.Kind != "" && route.Model.Kind != catalog.KindChat {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", kindEndpointMessage(route.Model.Kind), started)
			return true
		}
		return s.finishOpenAI(w, r, source, keyID, route, body, started, retry)
	default:
		if catalog.Adapted(route.Protocol) {
			return s.proxyAdapted(w, r, source, keyID, route, body, started, retry)
		}
		if route.Model.Kind == catalog.KindDecision || route.Protocol == catalog.ProtocolSystemOne {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "wrong_endpoint", kindEndpointMessage(catalog.KindDecision), started)
			return true
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "unsupported_protocol", "This provider protocol is not supported yet.", started)
		return true
	}
}

func (s *Server) proxyAdapted(w http.ResponseWriter, r *http.Request, source, keyID string, route store.Route, body []byte, started time.Time, retry bool) bool {
	prep, err := s.prepareAdapted(r, route, body)
	if err != nil {
		if retry {
			return false
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
		return true
	}
	if prep.Sign != nil {
		signed, err := http.NewRequest(prep.Method, prep.URL, nil)
		if err != nil {
			s.failChat(w, source, keyID, route.Model.ID, http.StatusBadRequest, "invalid_request_error", "invalid_body", err.Error(), started)
			return true
		}
		signed.Header = prep.Header
		awsig.Sign(signed, *prep.Sign, prep.Body, time.Now())
		prep.Header = signed.Header
	}
	resp, err := s.OpenAI.Send(r.Context(), prep.Method, prep.URL, prep.Body, prep.Header)
	if err != nil {
		if retry {
			return false
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	defer resp.Body.Close()
	s.noteQuota(route, resp.StatusCode, resp.Header)
	if resp.StatusCode == http.StatusUnauthorized && route.Protocol == catalog.ProtocolOAuthDevice && r.Context().Value(oauthRefreshKey{}) == nil && s.refreshOAuth(r.Context(), route) {
		route.APIKey = s.reloadedKey(route)
		r = r.WithContext(context.WithValue(r.Context(), oauthRefreshKey{}, true))
		return s.proxyAdapted(w, r, source, keyID, route, body, started, retry)
	}
	if resp.StatusCode >= 400 {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if retry {
			return false
		}
		s.failChat(w, source, keyID, route.Model.ID, resp.StatusCode, "server_error", "upstream_error", upstreamErrorMessage(payload), started)
		return true
	}
	if !prep.Wrap && strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "event-stream") {
		writeStreamHeaders(w, resp)
		_, _ = io.Copy(w, resp.Body)
		s.noteAccount(route)
		_ = s.addRouteLog(r, store.LogInput{Source: source, RouterKeyID: keyID, ModelID: route.Model.ID, StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds())})
		return true
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		if retry {
			return false
		}
		s.failChat(w, source, keyID, route.Model.ID, http.StatusBadGateway, "server_error", "upstream_error", err.Error(), started)
		return true
	}
	text := adapt.Text(payload)
	if route.Protocol == catalog.ProtocolComfy && strings.HasPrefix(text, "queued ") {
		if more := s.comfyHistory(r, route.BaseURL, strings.TrimPrefix(text, "queued ")); more != "" {
			text = more
		}
	}
	s.noteAccount(route)
	stampDecision(w, r, route, 0, 0)
	_ = s.addRouteLog(r, store.LogInput{Source: source, RouterKeyID: keyID, ModelID: route.Model.ID, StatusCode: resp.StatusCode, LatencyMS: int(time.Since(started).Milliseconds())})
	if prep.Wrap && streamAsked(body) {
		writeChatChunk(w, route.Model.ID, text, nil)
		return true
	}
	if prep.Wrap {
		writeJSON(w, http.StatusOK, openAICompletion(route.Model.ID, text, 0, 0))
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
	return true
}

func (s *Server) prepareAdapted(r *http.Request, route store.Route, body []byte) (adapt.Prepared, error) {
	switch route.Protocol {
	case catalog.ProtocolGitLab:
		return adapt.GitLab(route.BaseURL, route.APIKey, body), nil
	case catalog.ProtocolBedrock:
		return adapt.Bedrock(route.BaseURL, route.APIKey, body)
	case catalog.ProtocolSAP:
		prep, secretLine, err := adapt.SAP(route.BaseURL, route.APIKey, body)
		if err != nil {
			return prep, err
		}
		parts := strings.Split(secretLine, "\n")
		if len(parts) != 3 {
			return prep, errString("SAP service key is incomplete")
		}
		token, err := s.clientCredentials(r, parts[0], parts[1], parts[2])
		if err != nil {
			return prep, err
		}
		prep.Header.Set("Authorization", "Bearer "+token)
		return prep, nil
	case catalog.ProtocolClova:
		return adapt.Clova(route.BaseURL, route.APIKey, body), nil
	case catalog.ProtocolCloudAgent:
		_, prompt, _, _ := chatPrompt(body)
		return adapt.Agent(route.Model.ProviderSlug, route.BaseURL, route.APIKey, prompt), nil
	case catalog.ProtocolComfy:
		_, prompt, _, _ := chatPrompt(body)
		return adapt.Comfy(route.BaseURL, prompt), nil
	case catalog.ProtocolDuck:
		vqd, err := s.duckVQD(r, route.BaseURL)
		if err != nil {
			return adapt.Prepared{}, err
		}
		return adapt.DuckChat(route.BaseURL, vqd, body), nil
	case catalog.ProtocolOAuthDevice:
		return adapt.OAuthChat(route.BaseURL, route.APIKey, body), nil
	case catalog.ProtocolSession:
		return adapt.SessionChat(route.BaseURL, route.APIKey, body), nil
	default:
		return adapt.Prepared{}, errString("this provider protocol is not supported yet")
	}
}

func (s *Server) duckVQD(r *http.Request, base string) (string, error) {
	endpoint, header := adapt.DuckStatus(base)
	resp, err := s.OpenAI.Send(r.Context(), http.MethodGet, endpoint, nil, header)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return "", errString("DuckDuckGo did not start a chat session")
	}
	if vqd := resp.Header.Get("x-vqd-4"); vqd != "" {
		return vqd, nil
	}
	return "", errString("DuckDuckGo did not return a session token")
}

func (s *Server) comfyHistory(r *http.Request, base, id string) string {
	resp, err := s.OpenAI.Send(r.Context(), http.MethodGet, strings.TrimRight(base, "/")+"/history/"+url.PathEscape(id), nil, http.Header{})
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if text := adapt.Text(payload); text != "" && !strings.HasPrefix(text, "queued ") {
		return text
	}
	return ""
}

func (s *Server) clientCredentials(r *http.Request, tokenURL, clientID, secret string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", clientID)
	form.Set("client_secret", secret)
	header := http.Header{}
	header.Set("Content-Type", "application/x-www-form-urlencoded")
	header.Set("Accept", "application/json")
	resp, err := s.OpenAI.Send(r.Context(), http.MethodPost, tokenURL, []byte(form.Encode()), header)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	token, err := oauthflow.ParseToken(payload)
	if err != nil {
		return "", err
	}
	return token.AccessToken, nil
}

type oauthRefreshKey struct{}

func (s *Server) refreshOAuth(ctx context.Context, route store.Route) bool {
	token := oauthflow.Decode(route.APIKey)
	if token.RefreshToken == "" || token.TokenURL == "" || token.ClientID == "" {
		return false
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", token.RefreshToken)
	form.Set("client_id", token.ClientID)
	header := http.Header{}
	header.Set("Content-Type", "application/x-www-form-urlencoded")
	header.Set("Accept", "application/json")
	resp, err := s.OpenAI.Send(ctx, http.MethodPost, token.TokenURL, []byte(form.Encode()), header)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	next, err := oauthflow.ParseToken(payload)
	if err != nil {
		return false
	}
	if next.RefreshToken == "" {
		next.RefreshToken = token.RefreshToken
	}
	next.TokenURL = token.TokenURL
	next.ClientID = token.ClientID
	saved := oauthflow.Encode(next)
	if _, err := s.Store.UpdateProvider(route.Model.ProviderSlug, store.ProviderUpdate{APIKey: &saved}); err != nil {
		return false
	}
	return true
}

func (s *Server) reloadedKey(route store.Route) string {
	_, key, _, _, err := s.Store.ProviderSecret(route.Model.ProviderSlug)
	if err != nil {
		return route.APIKey
	}
	return key
}

func chatPrompt(body []byte) (model, prompt string, messages json.RawMessage, stream bool) {
	var parsed struct {
		Model    string          `json:"model"`
		Messages json.RawMessage `json:"messages"`
		Stream   bool            `json:"stream"`
	}
	_ = json.Unmarshal(body, &parsed)
	var items []struct {
		Content string `json:"content"`
	}
	_ = json.Unmarshal(parsed.Messages, &items)
	for i := len(items) - 1; i >= 0; i-- {
		if strings.TrimSpace(items[i].Content) != "" {
			return parsed.Model, items[i].Content, parsed.Messages, parsed.Stream
		}
	}
	return parsed.Model, "", parsed.Messages, parsed.Stream
}

func streamAsked(body []byte) bool {
	_, _, _, stream := chatPrompt(body)
	return stream
}

type errString string

func (e errString) Error() string { return string(e) }
