package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConsoleBesideExecutableWins(t *testing.T) {
	root := t.TempDir()
	packaged := filepath.Join(root, "exe", "console")
	if err := os.MkdirAll(packaged, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packaged, "index.html"), []byte("app"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := pickWebDir([]string{packaged})
	if got != packaged && filepath.Clean(got) != filepath.Clean(packaged) {
		t.Fatalf("got %s", got)
	}
}
