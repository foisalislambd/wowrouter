package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/httpapi"
	"wowrouter/server/internal/migrate"
)

type Options struct {
	Addr       string
	DataDir    string
	WebDir     string
	ConsoleDir string
	OnReady    func()
}

func Run(ctx context.Context, opt Options) error {
	if opt.Addr == "" {
		opt.Addr = "127.0.0.1:8787"
	}
	if opt.DataDir == "" {
		dir, err := DefaultDataDir()
		if err != nil {
			return err
		}
		opt.DataDir = dir
	}
	if err := validateListenAddr(opt.Addr); err != nil {
		return err
	}
	if err := os.MkdirAll(opt.DataDir, 0o700); err != nil {
		return err
	}
	sources := []string{opt.DataDir}
	if extra, err := legacyConfigDir(); err == nil && extra != opt.DataDir {
		sources = append(sources, extra)
	}
	if err := migrate.Prepare(opt.DataDir, sources); err != nil {
		return err
	}
	gatewayDB, bootstrap, err := admin.Open(filepath.Join(opt.DataDir, migrate.DBName))
	if err != nil {
		return err
	}
	defer gatewayDB.Close()
	if err := migrate.Apply(gatewayDB, opt.DataDir, sources); err != nil {
		return err
	}
	if os.Getenv("WOWROUTER_SAMPLE_DATA") == "1" {
		if err := admin.SeedSample(gatewayDB); err != nil {
			return err
		}
	}
	consoleDir := opt.WebDir
	if consoleDir == "" {
		consoleDir = opt.ConsoleDir
	}
	consoleDir = FindWebDir(consoleDir)
	runCtx, stop := context.WithCancel(ctx)
	defer stop()
	api := httpapi.New(opt.Addr, opt.DataDir)
	api.ConsoleDir = consoleDir
	api.Admin = admin.New(gatewayDB, "1.1.8")
	api.Stop = stop
	if bootstrap != "" {
		log.Printf("panel http://%s/", opt.Addr)
		log.Printf("admin token (shown once): %s", bootstrap)
	}
	server := &http.Server{
		Addr:              opt.Addr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
		BaseContext: func(_ net.Listener) context.Context {
			return runCtx
		},
	}

	listener, err := net.Listen("tcp", opt.Addr)
	if err != nil {
		return err
	}
	log.Printf("WowRouter listening on http://%s", opt.Addr)
	log.Printf("data directory: %s", opt.DataDir)
	if consoleDir == "" {
		log.Printf("panel build not found; API is up")
	} else {
		log.Printf("serving panel from %s", consoleDir)
	}
	errCh := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errCh <- err
	}()
	if opt.OnReady != nil {
		opt.OnReady()
	}

	select {
	case <-runCtx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return nil
	case err := <-errCh:
		return err
	}
}

func validateListenAddr(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("listen address: %w", err)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	if inDocker() && (host == "0.0.0.0" || host == "::") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("listen address must stay on this computer")
	}
	return nil
}

func inDocker() bool {
	return os.Getenv("WOWROUTER_IN_DOCKER") == "1"
}

func DefaultDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "wowrouter"), nil
}

func legacyConfigDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, migrate.LegacyDirName), nil
}

func FindWebDir(explicit string) string {
	exeDir := ""
	if exe, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exe)
	}
	var candidates []string
	if explicit != "" {
		candidates = append(candidates, explicit)
	}
	if exeDir != "" {
		candidates = append(candidates, filepath.Join(exeDir, "panel"))
	}
	candidates = append(candidates,
		filepath.Join("apps", "panel", "dist"),
		filepath.Join("panel"),
	)
	return pickWebDir(candidates)
}

func pickWebDir(candidates []string) string {
	for _, candidate := range candidates {
		info, err := os.Stat(filepath.Join(candidate, "index.html"))
		if err == nil && !info.IsDir() {
			abs, err := filepath.Abs(candidate)
			if err == nil {
				return abs
			}
			return candidate
		}
	}
	return ""
}

func WaitHealthy(addr string) error {
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if Probe(addr) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("WowRouter did not start on %s", addr)
}
