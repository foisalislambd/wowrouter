package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

// serveProxy is a minimal loopback reverse proxy. It does not authenticate,
// rewrite model ids, or write a request log. It is a baseline in this harness,
// not another product.
func serveProxy(addr, upstream string) error {
	target, err := url.Parse(upstream)
	if err != nil {
		return err
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1
	proxy.Transport = &http.Transport{
		MaxIdleConns:        1024,
		MaxIdleConnsPerHost: 1024,
		MaxConnsPerHost:     1024,
		IdleConnTimeout:     time.Minute,
		DisableCompression:  true,
		ForceAttemptHTTP2:   false,
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		http.Error(w, err.Error(), http.StatusBadGateway)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"bench-proxy"}`))
	})
	mux.Handle("/", proxy)
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       time.Minute,
	}
	return server.ListenAndServe()
}
