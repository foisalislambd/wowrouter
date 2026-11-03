package app

import "testing"

func TestValidateListenAddr(t *testing.T) {
	t.Setenv("AIROUTE_IN_DOCKER", "")
	for _, addr := range []string{"127.0.0.1:8787", "localhost:8787", "[::1]:8787"} {
		if err := validateListenAddr(addr); err != nil {
			t.Fatalf("%s: %v", addr, err)
		}
	}
	for _, addr := range []string{"0.0.0.0:8787", "192.168.1.5:8787", ":8787", "8787"} {
		if err := validateListenAddr(addr); err == nil {
			t.Fatalf("%s was accepted", addr)
		}
	}
}

func TestDockerMayListenOnAllInterfaces(t *testing.T) {
	t.Setenv("AIROUTE_IN_DOCKER", "1")
	for _, addr := range []string{"0.0.0.0:8787", "[::]:8787"} {
		if err := validateListenAddr(addr); err != nil {
			t.Fatalf("%s: %v", addr, err)
		}
	}
	if err := validateListenAddr("192.168.1.5:8787"); err == nil {
		t.Fatal("a LAN address was accepted inside Docker")
	}
}
