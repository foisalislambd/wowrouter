package store

import (
	"path/filepath"
	"testing"
	"time"

	"airoute/server/internal/quota"
	"airoute/server/internal/secret"
)

func TestFeaturesCacheAndQuota(t *testing.T) {
	dir := t.TempDir()
	key, err := secret.LoadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(filepath.Join(dir, "airoute.db"), key)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	saved, err := s.SaveFeatures(Features{Compression: "light", Cache: true, CacheTTL: 60, Memory: true})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Compression != "light" || !saved.Cache || !saved.Memory || saved.CacheTTL != 60 {
		t.Fatalf("features = %+v", saved)
	}
	if _, err := s.SaveOIDC(true, "http://example.com", "client", "secret"); err == nil {
		t.Fatal("expected public http issuer to be rejected")
	}
	pub, err := s.SaveOIDC(true, "http://127.0.0.1:9999", "client", "topsecret")
	if err != nil {
		t.Fatal(err)
	}
	if !pub.Enabled || !pub.HasSecret {
		t.Fatalf("oidc = %+v", pub)
	}
	opened, err := s.OIDCSecret()
	if err != nil || opened != "topsecret" {
		t.Fatalf("secret %q %v", opened, err)
	}
	locked, err := s.PanelLocked()
	if err != nil || !locked {
		t.Fatalf("locked %v %v", locked, err)
	}

	note, err := s.AddMemory("User prefers short answers.")
	if err != nil {
		t.Fatal(err)
	}
	text, err := s.MemoryText()
	if err != nil || text != note.Body {
		t.Fatalf("memory %q %v", text, err)
	}
	if err := s.PutCache("abc", `{"ok":true}`, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	body, ok, err := s.Cached("abc", time.Now())
	if err != nil || !ok || string(body) != `{"ok":true}` {
		t.Fatalf("cache %s %v %v", body, ok, err)
	}
	if err := s.SaveQuota("openai/gpt-6-luna", quota.Snapshot{Remaining: 3, Limit: 10, Known: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddQuotaHit("openai/gpt-6-luna", time.Now()); err != nil {
		t.Fatal(err)
	}
	windows, err := s.QuotaWindows([]string{"openai/gpt-6-luna", "missing"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if windows[0].Remaining != 3 || windows[0].Used != 1 || windows[1].Remaining != -1 {
		t.Fatalf("windows = %+v", windows)
	}
}
