package gateway

import (
	"errors"
	"net/url"
	"strings"
)

// SafeHTTPURL accepts https, and http only for this machine. Provider keys are sent to this URL.
func SafeHTTPURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.Scheme == "" || parsed.Hostname() == "" {
		return errors.New("base URL must be an absolute URL")
	}
	host := parsed.Hostname()
	if parsed.Scheme == "https" {
		return nil
	}
	if parsed.Scheme == "http" && (host == "127.0.0.1" || host == "localhost") {
		return nil
	}
	return errors.New("base URL must use https, or http on localhost")
}
