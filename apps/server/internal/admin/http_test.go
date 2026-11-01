package admin

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapTokenAndRouterKeyPrefix(t *testing.T) {
	dir := t.TempDir()
	store, token, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if token == "" || !strings.HasPrefix(token, "ak-wowrouter-") {
		t.Fatalf("token %q", token)
	}
	created, err := store.Put("keys", "app", map[string]any{"enabled": true}, "", false)
	if err != nil || !strings.HasPrefix(created.Once, "sk-wowrouter-") {
		t.Fatalf("key %q %v", created.Once, err)
	}
	if _, ok := store.AuthenticateKey(created.Once); !ok {
		t.Fatal("new key did not authenticate")
	}
	if _, ok := store.AuthenticateKey("sk-airoute-abc"); ok {
		t.Fatal("old key prefix authenticated")
	}
}
