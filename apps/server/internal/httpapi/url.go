package httpapi

import (
	"errors"
	"net/url"
	"strings"
)

func validateBaseURL(raw string) error {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	switch trimmed {
	case "auggie://cli/stdio", "devin://acp/stdio", "zcode://app-server/stdio", "codex-app-server://cli/websocket":
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || parsed.Scheme == "" || parsed.Hostname() == "" {
		return errors.New("base URL must be an absolute URL")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	host := parsed.Hostname()
	if parsed.Scheme == "http" && (host == "127.0.0.1" || host == "localhost") {
		return nil
	}
	return errors.New("base URL must use https, or http on localhost")
}
