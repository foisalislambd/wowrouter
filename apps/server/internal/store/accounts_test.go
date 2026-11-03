package store

import (
	"path/filepath"
	"testing"

	"airoute/server/internal/secret"
)

func TestMultipleAccountsRotate(t *testing.T) {
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

	firstKey := "sk-first-account-1111"
	enabled := true
	updated, err := s.UpdateProvider("openai", ProviderUpdate{APIKey: &firstKey, Enabled: &enabled})
	if err != nil {
		t.Fatal(err)
	}
	if updated.AccountCount != 1 || updated.AccountStrategy != "fill-first" || updated.APIKeyHint != "••••1111" {
		t.Fatalf("provider = %+v", updated)
	}

	secondKey := "sk-second-account-2222"
	name := "Backup"
	priority := 1
	second, err := s.CreateAccount("openai", AccountInput{Name: &name, APIKey: &secondKey, Priority: &priority})
	if err != nil {
		t.Fatal(err)
	}
	if second.APIKeyHint != "••••2222" || second.Name != "Backup" {
		t.Fatalf("second = %+v", second)
	}

	route, err := s.ResolveRoute("openai/gpt-6-luna")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetModelActive("openai", "gpt-6-luna", true); err != nil {
		t.Fatal(err)
	}
	route, err = s.ResolveRoute("openai/gpt-6-luna")
	if err != nil {
		t.Fatal(err)
	}
	parts, err := s.ExpandAccounts(route)
	if err != nil || len(parts) != 2 || parts[0].APIKey != firstKey || parts[1].APIKey != secondKey {
		t.Fatalf("fill-first = %#v %v", parts, err)
	}

	strategy := "round-robin"
	if _, err := s.UpdateProvider("openai", ProviderUpdate{AccountStrategy: &strategy}); err != nil {
		t.Fatal(err)
	}
	if err := s.TouchAccount(parts[0].AccountID); err != nil {
		t.Fatal(err)
	}
	parts, err = s.ExpandAccounts(route)
	if err != nil || len(parts) != 2 || parts[0].APIKey != secondKey || parts[1].APIKey != firstKey {
		t.Fatalf("round-robin = %#v %v", parts, err)
	}

	accounts, err := s.ListAccounts("openai")
	if err != nil || len(accounts) != 2 || accounts[0].LastUsedAt == nil || accounts[1].LastUsedAt != nil {
		t.Fatalf("list = %+v %v", accounts, err)
	}

	if err := s.DeleteAccount("openai", second.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount("openai", accounts[0].ID); err == nil {
		t.Fatal("expected delete of the last key to fail while the provider is on")
	}
}
