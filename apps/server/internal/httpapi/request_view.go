package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"airoute/server/internal/sse"
)

func providerRequest(method, endpoint string, header http.Header, body []byte) json.RawMessage {
	headers := map[string]string{}
	for key, values := range header {
		if len(values) == 0 {
			continue
		}
		value := values[0]
		if secretHeader(key) {
			value = redactSecret(value)
		}
		headers[key] = value
	}
	var parsed any
	view := truncateDataURLs(body)
	if len(view) == 0 {
		parsed = nil
	} else if err := json.Unmarshal(view, &parsed); err != nil {
		parsed = string(view)
	}
	raw, err := json.Marshal(map[string]any{
		"method":  method,
		"url":     endpoint,
		"headers": headers,
		"body":    parsed,
	})
	if err != nil {
		return nil
	}
	return raw
}

func writeRequestEvent(w http.ResponseWriter, request json.RawMessage) {
	if len(request) == 0 {
		return
	}
	_ = sse.WriteEvent(w, sse.Event{Name: "request", Data: string(request)})
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func writePlaygroundFailure(w http.ResponseWriter, status int, message string, request json.RawMessage) {
	body := map[string]any{"error": message}
	if len(request) > 0 {
		var parsed any
		if json.Unmarshal(request, &parsed) == nil {
			body["request"] = parsed
		}
	}
	writeJSON(w, status, body)
}

func secretHeader(key string) bool {
	switch strings.ToLower(key) {
	case "authorization", "cookie", "x-api-key", "x-goog-api-key", "api-key", "xi-api-key", "x-key":
		return true
	default:
		return false
	}
}

func redactSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	lower := strings.ToLower(value)
	for _, prefix := range []string{"bearer ", "key "} {
		if strings.HasPrefix(lower, prefix) {
			return value[:len(prefix)] + maskTail(strings.TrimSpace(value[len(prefix):]))
		}
	}
	return maskTail(value)
}

func maskTail(value string) string {
	if len(value) <= 4 {
		return "••••"
	}
	return "••••" + value[len(value)-4:]
}

func truncateDataURLs(body []byte) []byte {
	if len(body) == 0 {
		return body
	}
	var value any
	if json.Unmarshal(body, &value) != nil {
		return body
	}
	shrinkValue(&value)
	out, err := json.Marshal(value)
	if err != nil {
		return body
	}
	return out
}

func shrinkValue(value *any) {
	switch item := (*value).(type) {
	case map[string]any:
		for key, child := range item {
			item[key] = shrinkChild(child)
		}
	case []any:
		for i, child := range item {
			item[i] = shrinkChild(child)
		}
	}
}

func shrinkChild(child any) any {
	text, ok := child.(string)
	if ok && len(text) > 180 && strings.Contains(text, "data:") {
		return text[:40] + "… (" + strconv.Itoa(len(text)) + " chars)"
	}
	shrinkValue(&child)
	return child
}
