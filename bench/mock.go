package main

import (
	"bytes"
	"io"
	"net/http"
	"time"
)

// Instant chat completion and a short SSE stream. The upstream adds no scripted
// delay (the L0 profile in the Antirion harness): the handler answers as soon
// as it has read the request body.
var completionBody = []byte(`{"id":"chatcmpl-bench","object":"chat.completion","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":128,"completion_tokens":1,"total_tokens":129}}`)

var streamBody = []byte("" +
	"data: {\"id\":\"chatcmpl-bench\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"ok\"},\"finish_reason\":null}]}\n\n" +
	"data: {\"id\":\"chatcmpl-bench\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"gpt-4o-mini\",\"choices\":[],\"usage\":{\"prompt_tokens\":128,\"completion_tokens\":1,\"total_tokens\":129}}\n\n" +
	"data: [DONE]\n\n")

func mockHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"bench-mock"}`))
	})
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"gpt-4o-mini","object":"model","owned_by":"bench"}]}`))
	})
	chat := func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if bytes.Contains(body, []byte(`"stream":true`)) {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache")
			w.WriteHeader(http.StatusOK)
			flusher, _ := w.(http.Flusher)
			if _, err := w.Write(streamBody); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(completionBody)
	}
	mux.HandleFunc("POST /v1/chat/completions", chat)
	mux.HandleFunc("POST /chat/completions", chat)
	return mux
}

func serveMock(addr string) error {
	server := &http.Server{
		Addr:              addr,
		Handler:           mockHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       time.Minute,
	}
	return server.ListenAndServe()
}
