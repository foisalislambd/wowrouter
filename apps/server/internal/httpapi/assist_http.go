package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"airoute/server/internal/assist"
	"airoute/server/internal/quota"
	"airoute/server/internal/store"
)

func (s *Server) decorateChat(r *http.Request, body []byte) []byte {
	if s.Store == nil {
		return body
	}
	features, err := s.Store.Features()
	if err != nil {
		return body
	}
	if features.Compression == "light" {
		body = assist.Light(body)
	}
	if features.Memory && !headerOn(r, "X-WowRouter-No-Memory") {
		note, err := s.Store.MemoryText()
		if err == nil && note != "" {
			body = assist.PrependSystem(body, "Remembered notes:\n"+note)
		}
	}
	return body
}

func (s *Server) cacheLookup(r *http.Request, asked string, body []byte) []byte {
	if s.Store == nil || assist.StreamAsked(body) || headerOn(r, "X-WowRouter-No-Cache") {
		return nil
	}
	features, err := s.Store.Features()
	if err != nil || !features.Cache {
		return nil
	}
	payload, ok, err := s.Store.Cached(cacheKey(asked, body), time.Now())
	if err != nil || !ok {
		return nil
	}
	return payload
}

func (s *Server) rememberCache(r *http.Request, asked string, requestBody, payload []byte, status int, stream bool) {
	if s.Store == nil || stream || status >= 400 || headerOn(r, "X-WowRouter-No-Cache") || len(payload) == 0 {
		return
	}
	features, err := s.Store.Features()
	if err != nil || !features.Cache {
		return
	}
	ttl := features.CacheTTL
	if ttl <= 0 {
		ttl = 300
	}
	_ = s.Store.PutCache(cacheKey(asked, requestBody), string(payload), time.Now().Add(time.Duration(ttl)*time.Second))
}

func cacheKey(asked string, body []byte) string {
	sum := sha256.Sum256(append([]byte(strings.TrimSpace(asked)+"\n"), body...))
	return hex.EncodeToString(sum[:])
}

func headerOn(r *http.Request, name string) bool {
	if r == nil {
		return false
	}
	value := strings.TrimSpace(r.Header.Get(name))
	return value == "1" || strings.EqualFold(value, "true")
}

func (s *Server) noteQuota(route store.Route, status int, header http.Header) {
	if s.Store == nil || route.Model.ID == "" {
		return
	}
	snap := quota.Parse(status, header, time.Now())
	if snap.Known {
		_ = s.Store.SaveQuota(route.Model.ID, snap)
	}
	if status < 400 {
		_ = s.Store.AddQuotaHit(route.Model.ID, time.Now())
	}
}
