package admin

import (
	"path/filepath"
	"testing"
)

func TestRebind(t *testing.T) {
	got := rebind(`SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?`)
	want := `SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2`
	if got != want {
		t.Fatalf("%s", got)
	}
}

func TestPasswordFlagCannotBeSavedWithoutAHash(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	_, err = store.Put("settings", "auth", map[string]any{
		"admin": map[string]any{"local": map[string]any{"enabled": true}},
	}, "", false)
	if err == nil {
		t.Fatal("enabled password login with no hash")
	}
}

func TestBatchSurvivesANewStore(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wowrouter.db")
	store, _, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveBatch("batch_1", map[string]any{"id": "batch_1", "status": "completed"}); err != nil {
		t.Fatal(err)
	}
	store.Close()
	again, _, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	item, ok := again.Batch("batch_1")
	if !ok || item["status"] != "completed" {
		t.Fatalf("%#v %v", item, ok)
	}
}

func TestUserLoginRole(t *testing.T) {
	dir := t.TempDir()
	store, _, err := Open(filepath.Join(dir, "wowrouter.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.UpsertUser("ada@example.com", "correct horse battery", "operator"); err != nil {
		t.Fatal(err)
	}
	_, role, ok := store.CheckUser("ada@example.com", "correct horse battery")
	if !ok || role != "operator" {
		t.Fatalf("role %s ok %v", role, ok)
	}
}
