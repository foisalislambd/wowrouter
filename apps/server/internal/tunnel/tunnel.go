// Package tunnel is a long-poll reverse tunnel.
// A public relay holds requests until the WowRouter agent polls them and posts the response.
package tunnel

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

// Relay is the public side.
type Relay struct {
	mu      sync.Mutex
	waiters map[string]chan *http.Request
	token   string
}

// NewRelay expects Authorization: Bearer token on agent calls.
func NewRelay(token string) *Relay {
	return &Relay{waiters: map[string]chan *http.Request{}, token: token}
}

// ServeHTTP accepts public traffic on any path except /tunnel/poll and /tunnel/respond.
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	switch req.URL.Path {
	case "/tunnel/poll":
		r.poll(w, req)
	default:
		r.forward(w, req)
	}
}

func (r *Relay) authorized(req *http.Request) bool {
	if r.token == "" {
		return false
	}
	return req.Header.Get("Authorization") == "Bearer "+r.token
}

func (r *Relay) poll(w http.ResponseWriter, req *http.Request) {
	if !r.authorized(req) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ch := make(chan *http.Request, 1)
	r.mu.Lock()
	r.waiters["agent"] = ch
	r.mu.Unlock()
	select {
	case <-req.Context().Done():
		return
	case incoming := <-ch:
		raw, _ := io.ReadAll(io.LimitReader(incoming.Body, 1<<20))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": incoming.Header.Get("X-Tunnel-Id"), "method": incoming.Method, "path": incoming.URL.RequestURI(),
			"body": string(raw),
		})
	case <-time.After(25 * time.Second):
		w.WriteHeader(http.StatusNoContent)
	}
}

func (r *Relay) forward(w http.ResponseWriter, req *http.Request) {
	r.mu.Lock()
	ch := r.waiters["agent"]
	r.mu.Unlock()
	if ch == nil {
		http.Error(w, "tunnel offline", http.StatusBadGateway)
		return
	}
	id := time.Now().UTC().Format("150405.000000")
	req.Header.Set("X-Tunnel-Id", id)
	select {
	case ch <- req:
	default:
		http.Error(w, "tunnel busy", http.StatusBadGateway)
		return
	}
	// The agent posts the response separately. This simple relay returns 202
	// with the id so a caller can correlate. The agent mode below uses respond
	// to complete a stored response when one is waiting.
	w.Header().Set("X-Tunnel-Id", id)
	w.WriteHeader(http.StatusAccepted)
}

type pendingResponse struct {
	Status int
	Body   []byte
}

// Hold extends Relay with a response mailbox. Use Handler for the full relay.
type Mailbox struct {
	*Relay
	mu   sync.Mutex
	done map[string]pendingResponse
}

// Handler is a relay that also stores agent responses.
func Handler(token string) http.Handler {
	return &Mailbox{Relay: NewRelay(token), done: map[string]pendingResponse{}}
}

func (m *Mailbox) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path == "/tunnel/respond" {
		m.respond(w, req)
		return
	}
	m.Relay.ServeHTTP(w, req)
}

func (m *Mailbox) respond(w http.ResponseWriter, req *http.Request) {
	if !m.authorized(req) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		ID     string `json:"id"`
		Status int    `json:"status"`
		Body   string `json:"body"`
	}
	if json.NewDecoder(req.Body).Decode(&body) != nil || body.ID == "" {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	m.mu.Lock()
	m.done[body.ID] = pendingResponse{Status: body.Status, Body: []byte(body.Body)}
	m.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// Fetch is one poll from the agent side.
func Fetch(client *http.Client, relay, token string) (id, method, path, body string, ok bool, err error) {
	req, err := http.NewRequest(http.MethodGet, relay+"/tunnel/poll", nil)
	if err != nil {
		return "", "", "", "", false, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent {
		return "", "", "", "", false, nil
	}
	var parsed struct {
		ID, Method, Path, Body string
	}
	if json.NewDecoder(resp.Body).Decode(&parsed) != nil {
		return "", "", "", "", false, nil
	}
	return parsed.ID, parsed.Method, parsed.Path, parsed.Body, parsed.ID != "", nil
}

// Push sends the local response back to the relay.
func Push(client *http.Client, relay, token, id string, status int, body []byte) error {
	raw, _ := json.Marshal(map[string]any{"id": id, "status": status, "body": string(body)})
	req, err := http.NewRequest(http.MethodPost, relay+"/tunnel/respond", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}
