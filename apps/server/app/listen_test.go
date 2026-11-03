package app

import "testing"

func TestLoopbackIsNotPublic(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:8787", "localhost:8787", "[::1]:8787"} {
		if err := checkListenAddr(addr); err != nil {
			t.Fatalf("%s: %v", addr, err)
		}
		if Public(addr) {
			t.Fatalf("%s was public", addr)
		}
		if err := AllowPublic(addr, false, false); err != nil {
			t.Fatalf("%s: %v", addr, err)
		}
	}
}

func TestPublicBindRequiresAuth(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:8787", "192.168.1.5:8787", ":8787"} {
		if err := checkListenAddr(addr); err != nil {
			t.Fatalf("%s: %v", addr, err)
		}
		if !Public(addr) {
			t.Fatalf("%s was treated as loopback", addr)
		}
		if err := AllowPublic(addr, false, false); err == nil {
			t.Fatalf("%s started without authentication", addr)
		}
		if err := AllowPublic(addr, true, false); err != nil {
			t.Fatal(err)
		}
		if err := AllowPublic(addr, false, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := checkListenAddr("8787"); err == nil {
		t.Fatal("missing host:port was accepted")
	}
}
