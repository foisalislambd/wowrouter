package main

import (
	"encoding/json"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestChatBodyIsJSON(t *testing.T) {
	body := chatBody("openai/gpt-4o-mini", false)
	if !json.Valid(body) {
		t.Fatalf("chat body is not JSON: %s", body)
	}
	stream := chatBody("openai/gpt-4o-mini", true)
	if !json.Valid(stream) {
		t.Fatal("stream body is not JSON")
	}
}

func TestMockAnswersChat(t *testing.T) {
	server := &http.Server{Handler: mockHandler()}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	go func() { _ = server.Serve(ln) }()

	url := "http://" + ln.Addr().String() + "/v1/chat/completions"
	metrics := runLoad(LoadSpec{
		URL:     url,
		Body:    chatBody("gpt-4o-mini", false),
		Auth:    "sk-bench-upstream",
		Rate:    40,
		Warmup:  0,
		Measure: time.Second,
		Timeout: 2 * time.Second,
		Expect:  200,
	})
	if metrics.Success != 40 {
		t.Fatalf("success = %d, errors = %d (%v)", metrics.Success, metrics.Errors, metrics.ErrorsByClass)
	}
	if metrics.LatencyP50Us <= 0 {
		t.Fatal("expected a positive p50")
	}

	closed := runLoad(LoadSpec{
		URL:         url,
		Body:        chatBody("gpt-4o-mini", true),
		Auth:        "sk-bench-upstream",
		Concurrency: 2,
		Warmup:      0,
		Measure:     200 * time.Millisecond,
		Timeout:     2 * time.Second,
		Stream:      true,
		Expect:      200,
	})
	if closed.Success == 0 {
		t.Fatalf("closed loop produced no successes: %+v", closed)
	}
	if closed.TTFTP50Us <= 0 {
		t.Fatal("expected a stream TTFT")
	}
}
