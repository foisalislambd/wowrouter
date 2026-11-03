// Package notify delivers alert webhooks. Delivery is opt-in: a channel
// with a url is posted; channels without a url are ignored.
package notify

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Message is one outbound alert.
type Message struct {
	ID       string         `json:"id"`
	Title    string         `json:"title"`
	Body     string         `json:"body"`
	Severity string         `json:"severity"`
	At       string         `json:"at"`
	Extra    map[string]any `json:"extra,omitempty"`
}

// Channel is a saved webhook destination.
type Channel struct {
	Name   string
	URL    string
	Secret string
}

// Post signs the body with HMAC-SHA256 when secret is set and waits for a 2xx.
func Post(client *http.Client, ch Channel, msg Message) error {
	if ch.URL == "" {
		return fmt.Errorf("channel %s has no url", ch.Name)
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	if msg.At == "" {
		msg.At = time.Now().UTC().Format(time.RFC3339)
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, ch.URL, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "wowrouter-webhook")
	if ch.Secret != "" {
		mac := hmac.New(sha256.New, []byte(ch.Secret))
		_, _ = mac.Write(raw)
		req.Header.Set("X-WowRouter-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook %s returned %d", ch.Name, resp.StatusCode)
	}
	return nil
}
