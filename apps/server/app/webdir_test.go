package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPackagedPanelWinsOverWorkingDirectory(t *testing.T) {
	root := t.TempDir()
	packaged := filepath.Join(root, "exe", "panel")
	cwdDist := filepath.Join(root, "dist")
	if err := os.MkdirAll(packaged, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(cwdDist, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packaged, "index.html"), []byte("app"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cwdDist, "index.html"), []byte("other"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := pickWebDir(webDirCandidates("", filepath.Join(root, "exe")))
	if got != packaged && filepath.Clean(got) != filepath.Clean(packaged) {
		t.Fatalf("got %s, want the panel next to the executable", got)
	}
}
