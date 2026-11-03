package app

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// Probe reports whether a WowRouter agent is already answering on addr.
func Probe(addr string) bool {
	client := &http.Client{Timeout: 400 * time.Millisecond}
	defer client.CloseIdleConnections()
	resp, err := client.Get("http://" + addr + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var body struct {
		Service string `json:"service"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1024)).Decode(&body) != nil {
		return false
	}
	return body.Service == "wowrouter" || body.Service == "airoute"
}
