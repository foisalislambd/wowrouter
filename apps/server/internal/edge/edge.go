// Package edge is the HTTP front of a WowRouter process: CORS, trusted
// proxies, request metrics, and the client IP other packages should use.
package edge

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"wowrouter/server/internal/metrics"
)

type ipKey struct{}

// Config is the public edge of one process.
type Config struct {
	CORSOrigins    []string
	TrustedProxies []*net.IPNet
}

// Wrap applies the edge policy around the application handler.
func Wrap(cfg Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowedOrigin(cfg.CORSOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions && origin != "" && allowedOrigin(cfg.CORSOrigins, origin) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		ip := clientIP(r, cfg.TrustedProxies)
		r = r.WithContext(context.WithValue(r.Context(), ipKey{}, ip))
		done := metrics.Begin()
		sw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(sw, r)
		done()
		metrics.Observe(sw.code, time.Since(start))
	})
}

// ClientIP is the address recorded by Wrap, or the socket address.
func ClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if v, ok := r.Context().Value(ipKey{}).(string); ok && v != "" {
		return v
	}
	return hostOnly(r.RemoteAddr)
}

func allowedOrigin(list []string, origin string) bool {
	for _, item := range list {
		if item == "*" || strings.EqualFold(item, origin) {
			return true
		}
	}
	return false
}

func clientIP(r *http.Request, trusted []*net.IPNet) string {
	peer := net.ParseIP(hostOnly(r.RemoteAddr))
	if peer != nil && contains(trusted, peer) {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			first := strings.TrimSpace(strings.Split(fwd, ",")[0])
			if ip := net.ParseIP(first); ip != nil {
				return ip.String()
			}
		}
	}
	return hostOnly(r.RemoteAddr)
}

func contains(nets []*net.IPNet, ip net.IP) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func hostOnly(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

// ParseCIDRs parses comma-separated CIDRs and bare IPs.
func ParseCIDRs(raw string) ([]*net.IPNet, error) {
	var out []*net.IPNet
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.Contains(part, "/") {
			ip := net.ParseIP(part)
			if ip == nil {
				return nil, errors.New("bad proxy address " + part)
			}
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			part = ip.String() + "/" + itoa(bits)
		}
		_, n, err := net.ParseCIDR(part)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("websocket is not available")
	}
	return h.Hijack()
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
