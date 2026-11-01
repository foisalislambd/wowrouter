package httpapi

import "testing"

func TestRemoteAllowed(t *testing.T) {
	rules := []any{"10.0.0.0/8", "192.168.1.9"}
	if !remoteAllowed("10.1.2.3:443", rules) {
		t.Fatal("cidr")
	}
	if !remoteAllowed("192.168.1.9:80", rules) {
		t.Fatal("exact")
	}
	if remoteAllowed("172.16.0.4:80", rules) {
		t.Fatal("denied")
	}
	if !remoteAllowed("1.2.3.4:1", []any{"*"}) {
		t.Fatal("star")
	}
	if remoteAllowed("1.2.3.4:1", []any{"not-an-ip"}) {
		t.Fatal("junk rule should fail closed")
	}
}

func TestWebSocketFrameLength(t *testing.T) {
	short := wsTextFrame([]byte("hi"))
	if short[0] != 0x81 || short[1] != 2 {
		t.Fatalf("%v", short[:2])
	}
	payload := make([]byte, 200)
	frame := wsTextFrame(payload)
	if frame[1] != 126 || int(frame[2])<<8|int(frame[3]) != 200 {
		t.Fatalf("%v", frame[:4])
	}
	if len(frame) != 4+200 {
		t.Fatal(len(frame))
	}
}

func TestPublicBase(t *testing.T) {
	if publicBase(":8787") != "http://127.0.0.1:8787" {
		t.Fatal(publicBase(":8787"))
	}
}
