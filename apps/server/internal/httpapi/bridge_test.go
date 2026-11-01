package httpapi

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBridgeSessionAuth(t *testing.T) {
	s := &Server{}
	remote := httptest.NewRequest(http.MethodGet, "/v1/bridge", nil)
	remote.RemoteAddr = "203.0.113.8:443"
	session, code, _ := s.bridgeSession(remote)
	if code != 0 || session.Authed {
		t.Fatalf("remote should wait for an auth message: %+v %d", session, code)
	}
	remote.Header.Set("Authorization", "Bearer sk-nope")
	_, code, _ = s.bridgeSession(remote)
	if code != http.StatusUnauthorized {
		t.Fatal(code)
	}
	local := httptest.NewRequest(http.MethodGet, "/v1/bridge", nil)
	local.RemoteAddr = "127.0.0.1:9"
	session, code, _ = s.bridgeSession(local)
	if code != 0 || !session.Authed {
		t.Fatal("loopback")
	}
}

func TestBridgeChatPingAndClose(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	started := make(chan struct{})
	release := make(chan struct{})
	go serveBridge(server, server, bridgeSession{
		Authed: false,
		Check: func(token string) (string, bool) {
			if token == "sk-ok" {
				return "gw:app", true
			}
			return "", false
		},
		Chat: func(keyID string, msg map[string]any) bridgeResult {
			if msg["stream"] == true {
				return bridgeResult{Status: 200, Stream: io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n"))}
			}
			close(started)
			<-release
			return bridgeResult{Status: 200, Body: []byte(`{"ok":true}`)}
		},
	})
	_ = client.SetDeadline(time.Now().Add(3 * time.Second))
	if op, payload := readClientFrame(t, client); op != 0x1 || !strings.Contains(string(payload), `"ready"`) {
		t.Fatalf("ready %x %s", op, payload)
	}

	writeClient(t, client, 0x1, []byte(`{"type":"chat","id":"1","model":"m"}`))
	if _, payload := readClientFrame(t, client); !strings.Contains(string(payload), "auth required") {
		t.Fatal(string(payload))
	}
	writeClient(t, client, 0x1, []byte(`{"type":"auth","token":"nope"}`))
	if _, payload := readClientFrame(t, client); !strings.Contains(string(payload), "incorrect api key") {
		t.Fatal(string(payload))
	}
	writeClient(t, client, 0x1, []byte(`{"type":"auth","token":"sk-ok"}`))
	if _, payload := readClientFrame(t, client); !strings.Contains(string(payload), `"ok":true`) {
		t.Fatal(string(payload))
	}

	writeClient(t, client, 0x1, []byte(`{"type":"chat","id":"2","model":"m","messages":[]}`))
	<-started
	writeClient(t, client, 0x9, []byte("ping"))
	op, payload := readClientFrame(t, client)
	if op != 0xA || string(payload) != "ping" {
		t.Fatalf("pong %x %q", op, payload)
	}
	close(release)
	if _, payload = readClientFrame(t, client); !strings.Contains(string(payload), `"ok":true`) {
		t.Fatal(string(payload))
	}

	writeClient(t, client, 0x1, []byte(`{"type":"ping"}`))
	if _, payload = readClientFrame(t, client); !strings.Contains(string(payload), `"pong"`) {
		t.Fatal(string(payload))
	}
	writeClient(t, client, 0x1, []byte(`{"type":"chat","id":"3","model":"m","stream":true}`))
	if _, payload = readClientFrame(t, client); !strings.Contains(string(payload), `"delta"`) || !strings.Contains(string(payload), "hi") {
		t.Fatal(string(payload))
	}
	if _, payload = readClientFrame(t, client); !strings.Contains(string(payload), `"done"`) {
		t.Fatal(string(payload))
	}

	writeClient(t, client, 0x8, []byte{0x03, 0xe8})
	op, _ = readClientFrame(t, client)
	if op != 0x8 {
		t.Fatalf("close %x", op)
	}
}

func TestBridgeFragmentAndUpgrade(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	go serveBridge(server, server, bridgeSession{Authed: true, Chat: func(string, map[string]any) bridgeResult {
		return bridgeResult{Status: 200, Body: []byte(`{"ok":true}`)}
	}})
	_ = client.SetDeadline(time.Now().Add(2 * time.Second))
	readClientFrame(t, client)
	body := []byte(`{"type":"chat","id":"f","model":"m"}`)
	first := wsClientFrame(0x1, body[:8])
	first[0] = 0x01
	if _, err := client.Write(first); err != nil {
		t.Fatal(err)
	}
	second := wsClientFrame(0x0, body[8:])
	if _, err := client.Write(second); err != nil {
		t.Fatal(err)
	}
	if _, payload := readClientFrame(t, client); !strings.Contains(string(payload), `"ok":true`) {
		t.Fatal(string(payload))
	}

	s := &Server{}
	srv := httptest.NewServer(http.HandlerFunc(s.bridge))
	defer srv.Close()
	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET /v1/bridge HTTP/1.1\r\nHost: "+strings.TrimPrefix(srv.URL, "http://")+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil || !strings.Contains(status, "101") {
		t.Fatal(status, err)
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil || line == "\r\n" {
			break
		}
	}
	_, op, payload, err := readWSFrame(br)
	if err != nil || op != 0x1 || !strings.Contains(string(payload), "ready") {
		t.Fatalf("%x %s %v", op, payload, err)
	}
}

func writeClient(t *testing.T, conn net.Conn, op byte, payload []byte) {
	t.Helper()
	if _, err := conn.Write(wsClientFrame(op, payload)); err != nil {
		t.Fatal(err)
	}
}

func readClientFrame(t *testing.T, conn net.Conn) (byte, []byte) {
	t.Helper()
	_, op, payload, err := readWSFrame(conn)
	if err != nil {
		t.Fatal(err)
	}
	return op, payload
}
