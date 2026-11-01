package httpapi

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

type bridgeSession struct {
	Authed bool
	KeyID  string
	Check  func(token string) (string, bool)
	Chat   func(keyID string, msg map[string]any) bridgeResult
}

type bridgeResult struct {
	Status int
	Body   []byte
	Stream io.ReadCloser
	Error  string
}

type bridgeMsg struct {
	op      byte
	payload []byte
}

func (s *Server) bridgeSession(r *http.Request) (bridgeSession, int, string) {
	session := bridgeSession{Check: s.checkBridgeToken, Chat: s.engineBridge}
	token := bearerToken(r)
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ip := net.ParseIP(host)
	loopback := ip != nil && ip.IsLoopback()
	if token != "" {
		keyID, ok := session.Check(token)
		if !ok {
			return bridgeSession{}, http.StatusUnauthorized, "Incorrect API key."
		}
		session.Authed = true
		session.KeyID = keyID
		return session, 0, ""
	}
	if loopback {
		session.Authed = true
	}
	return session, 0, ""
}

func (s *Server) checkBridgeToken(token string) (string, bool) {
	if s == nil || s.Admin == nil || s.Admin.Store == nil {
		return "", false
	}
	key, ok := s.Admin.Store.AuthenticateKey(token)
	if !ok {
		return "", false
	}
	return "gw:" + key.Name, true
}

func (s *Server) engineBridge(keyID string, msg map[string]any) bridgeResult {
	if s == nil || s.Admin == nil || s.Admin.Engine == nil {
		return bridgeResult{Status: http.StatusServiceUnavailable, Error: "gateway is not configured"}
	}
	model := strings.TrimSpace(str(msg["model"]))
	if model == "" {
		return bridgeResult{Status: http.StatusBadRequest, Error: "model is required"}
	}
	body := map[string]any{"model": model, "messages": msg["messages"]}
	if msg["stream"] == true {
		body["stream"] = true
	}
	call := s.callFromKey(keyID, model, body, "openai")
	out := s.Admin.Engine.Handle(call)
	if out.Stream != nil {
		return bridgeResult{Status: out.Status, Stream: out.Stream}
	}
	if out.Status >= 400 {
		errText := out.Error
		if errText == "" {
			errText = "upstream failed"
		}
		return bridgeResult{Status: out.Status, Body: out.Body, Error: errText}
	}
	return bridgeResult{Status: out.Status, Body: out.Body}
}

func serveBridge(conn io.WriteCloser, reader io.Reader, session bridgeSession) {
	defer conn.Close()
	var writeMu sync.Mutex
	write := func(op byte, payload []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_, err := conn.Write(wsFrame(op, payload))
		return err
	}
	if err := write(0x1, []byte(`{"type":"ready","service":"wowrouter"}`)); err != nil {
		return
	}
	msgs := make(chan bridgeMsg)
	go readBridge(reader, write, msgs)
	for msg := range msgs {
		if msg.op == 0x8 {
			_ = write(0x8, msg.payload)
			return
		}
		if msg.op != 0x1 {
			continue
		}
		var incoming map[string]any
		if json.Unmarshal(msg.payload, &incoming) != nil {
			_ = write(0x1, []byte(`{"type":"error","error":"invalid json"}`))
			continue
		}
		switch str(incoming["type"]) {
		case "ping":
			_ = write(0x1, []byte(`{"type":"pong"}`))
		case "close":
			_ = write(0x8, nil)
			return
		case "auth":
			token := strings.TrimSpace(str(incoming["token"]))
			keyID, ok := "", false
			if session.Check != nil {
				keyID, ok = session.Check(token)
			}
			if !ok {
				_ = write(0x1, []byte(`{"type":"error","error":"incorrect api key"}`))
				continue
			}
			session.Authed = true
			session.KeyID = keyID
			raw, _ := json.Marshal(map[string]any{"type": "auth", "ok": true})
			_ = write(0x1, raw)
		case "chat":
			if !session.Authed {
				id := str(incoming["id"])
				raw, _ := json.Marshal(map[string]any{"type": "error", "id": id, "error": "auth required"})
				_ = write(0x1, raw)
				continue
			}
			if session.Chat == nil {
				_ = write(0x1, []byte(`{"type":"error","error":"gateway is not configured"}`))
				continue
			}
			result := session.Chat(session.KeyID, incoming)
			writeBridgeResult(write, str(incoming["id"]), result)
		default:
			_ = write(0x1, []byte(`{"type":"error","error":"unknown message"}`))
		}
	}
}

func writeBridgeResult(write func(byte, []byte) error, id string, result bridgeResult) {
	if result.Stream != nil {
		defer result.Stream.Close()
		sc := bufio.NewScanner(result.Stream)
		sc.Buffer(make([]byte, 64*1024), 1<<20)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, ":") {
				continue
			}
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "[DONE]" {
				break
			}
			raw, _ := json.Marshal(map[string]any{"type": "delta", "id": id, "data": json.RawMessage(data)})
			if json.Valid([]byte(data)) {
				_ = write(0x1, raw)
			} else {
				raw, _ = json.Marshal(map[string]any{"type": "delta", "id": id, "data": data})
				_ = write(0x1, raw)
			}
		}
		raw, _ := json.Marshal(map[string]any{"type": "done", "id": id})
		_ = write(0x1, raw)
		return
	}
	if result.Status >= 400 || result.Error != "" && result.Status == 0 {
		status := result.Status
		if status == 0 {
			status = http.StatusBadGateway
		}
		raw, _ := json.Marshal(map[string]any{"type": "error", "id": id, "status": status, "error": result.Error})
		_ = write(0x1, raw)
		return
	}
	env := map[string]any{"type": "chat", "id": id, "status": result.Status}
	if json.Valid(result.Body) {
		env["body"] = json.RawMessage(result.Body)
	} else if len(result.Body) > 0 {
		env["body"] = string(result.Body)
	}
	raw, _ := json.Marshal(env)
	_ = write(0x1, raw)
}

func readBridge(r io.Reader, write func(byte, []byte) error, out chan<- bridgeMsg) {
	defer close(out)
	var acc []byte
	var accOp byte
	for {
		fin, op, payload, err := readWSFrame(r)
		if err != nil {
			return
		}
		switch op {
		case 0x9:
			if write(0xA, payload) != nil {
				return
			}
			continue
		case 0xA:
			continue
		case 0x8:
			out <- bridgeMsg{op: 0x8, payload: payload}
			return
		case 0x0:
			acc = append(acc, payload...)
		case 0x1, 0x2:
			acc = append(acc[:0], payload...)
			accOp = op
		default:
			continue
		}
		if len(acc) > 1<<20 {
			return
		}
		if fin {
			copied := append([]byte(nil), acc...)
			out <- bridgeMsg{op: accOp, payload: copied}
			acc = acc[:0]
		}
	}
}

func readWSFrame(r io.Reader) (fin bool, op byte, payload []byte, err error) {
	var hdr [2]byte
	if _, err = io.ReadFull(r, hdr[:]); err != nil {
		return false, 0, nil, err
	}
	fin = hdr[0]&0x80 != 0
	op = hdr[0] & 0x0f
	masked := hdr[1]&0x80 != 0
	n := uint64(hdr[1] & 0x7f)
	switch n {
	case 126:
		var ext [2]byte
		if _, err = io.ReadFull(r, ext[:]); err != nil {
			return false, 0, nil, err
		}
		n = uint64(ext[0])<<8 | uint64(ext[1])
	case 127:
		var ext [8]byte
		if _, err = io.ReadFull(r, ext[:]); err != nil {
			return false, 0, nil, err
		}
		n = uint64(ext[0])<<56 | uint64(ext[1])<<48 | uint64(ext[2])<<40 | uint64(ext[3])<<32 |
			uint64(ext[4])<<24 | uint64(ext[5])<<16 | uint64(ext[6])<<8 | uint64(ext[7])
	}
	if n > 1<<20 {
		return false, 0, nil, io.ErrUnexpectedEOF
	}
	var mask [4]byte
	if masked {
		if _, err = io.ReadFull(r, mask[:]); err != nil {
			return false, 0, nil, err
		}
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(r, payload); err != nil {
		return false, 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return fin, op, payload, nil
}

func wsFrame(op byte, payload []byte) []byte {
	frame := []byte{0x80 | op}
	n := len(payload)
	switch {
	case n < 126:
		frame = append(frame, byte(n))
	case n <= 65535:
		frame = append(frame, 126, byte(n>>8), byte(n))
	default:
		frame = append(frame, 127,
			byte(n>>56), byte(n>>48), byte(n>>40), byte(n>>32),
			byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}
	return append(frame, payload...)
}

func wsTextFrame(payload []byte) []byte { return wsFrame(0x1, payload) }

func wsClientFrame(op byte, payload []byte) []byte {
	frame := wsFrame(op, nil)
	n := len(payload)
	frame = frame[:1]
	switch {
	case n < 126:
		frame = append(frame, 0x80|byte(n))
	case n <= 65535:
		frame = append(frame, 0x80|126, byte(n>>8), byte(n))
	default:
		frame = append(frame, 0x80|127,
			byte(n>>56), byte(n>>48), byte(n>>40), byte(n>>32),
			byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}
	mask := []byte{0x11, 0x22, 0x33, 0x44}
	frame = append(frame, mask...)
	for i, b := range payload {
		frame = append(frame, b^mask[i%4])
	}
	return frame
}
