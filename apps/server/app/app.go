package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/acme/autocert"
	"wowrouter/server/internal/admin"
	"wowrouter/server/internal/edge"
	"wowrouter/server/internal/httpapi"
	"wowrouter/server/internal/migrate"
	"wowrouter/server/internal/secret"
)

type Options struct {
	Addr           string
	DataDir        string
	WebDir         string
	ConsoleDir     string
	DatabaseURL    string
	TLSCert        string
	TLSKey         string
	TLSDomain      string
	CORSOrigins    []string
	TrustedProxies string
	PublicBind     string
	AdminPassword  string
	AdminEmail     string
	LogFormat      string
	SyncPeer       string
	SyncToken      string
	Shutdown       time.Duration
	OnReady        func()
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
	if err := checkListenAddr(opt.Addr); err != nil {
		return err
	}
	if opt.LogFormat == "json" {
		log.SetFlags(0)
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
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
	gatewayDB, bootstrap, err := admin.OpenDatabase(opt.DatabaseURL, filepath.Join(opt.DataDir, migrate.DBName), opt.DataDir)
	if err != nil {
		return err
	}
	defer gatewayDB.Close()
	if key, err := secret.LoadKey(opt.DataDir); err != nil {
		return err
	} else if err := gatewayDB.UseSeal(key); err != nil {
		return err
	}
	if err := migrate.Apply(gatewayDB, opt.DataDir, sources); err != nil {
		return err
	}
	if opt.AdminPassword != "" {
		enabled, email, hash := gatewayDB.PasswordLogin()
		if hash == "" {
			if email == "" {
				email = opt.AdminEmail
			}
			if email == "" {
				email = "admin@localhost"
			}
			if err := gatewayDB.SetPassword(email, opt.AdminPassword, "", true); err != nil {
				return err
			}
		} else if !enabled {
			if err := gatewayDB.SetPassword(email, "", opt.AdminPassword, true); err != nil {
				return fmt.Errorf("password sign-in is installed but turned off, and WOWROUTER_ADMIN_PASSWORD did not match: %w", err)
			}
		}
	}
	passwordOn, _, hash := gatewayDB.PasswordLogin()
	if err := AllowPublic(opt.Addr, passwordOn && hash != "", strings.EqualFold(opt.PublicBind, "token")); err != nil {
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
	proxies, err := edge.ParseCIDRs(opt.TrustedProxies)
	if err != nil {
		return err
	}
	scheme := "http"
	if opt.TLSCert != "" || opt.TLSDomain != "" {
		scheme = "https"
	}
	server := &http.Server{
		Addr:              opt.Addr,
		Handler:           edge.Wrap(edge.Config{CORSOrigins: opt.CORSOrigins, TrustedProxies: proxies}, api.Handler()),
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
	log.Printf("WowRouter listening on %s://%s", scheme, opt.Addr)
	log.Printf("data directory: %s", opt.DataDir)
	if consoleDir == "" {
		log.Printf("panel build not found; API is up")
	} else {
		log.Printf("serving panel from %s", consoleDir)
	}
	errCh := make(chan error, 1)
	go func() {
		var err error
		switch {
		case opt.TLSCert != "" && opt.TLSKey != "":
			err = server.ServeTLS(listener, opt.TLSCert, opt.TLSKey)
		case opt.TLSDomain != "":
			mgr := &autocert.Manager{
				Prompt:     autocert.AcceptTOS,
				HostPolicy: autocert.HostWhitelist(opt.TLSDomain),
				Cache:      autocert.DirCache(filepath.Join(opt.DataDir, "autocert")),
			}
			server.TLSConfig = &tls.Config{GetCertificate: mgr.GetCertificate, MinVersion: tls.VersionTLS12}
			err = server.ServeTLS(listener, "", "")
		default:
			err = server.Serve(listener)
		}
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errCh <- err
	}()
	if opt.SyncPeer != "" {
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for {
				select {
				case <-runCtx.Done():
					return
				case <-ticker.C:
					_ = admin.PullSnapshot(gatewayDB, opt.SyncPeer, opt.SyncToken, nil)
				}
			}
		}()
	}
	if opt.OnReady != nil {
		opt.OnReady()
	}

	wait := opt.Shutdown
	if wait <= 0 {
		wait = 15 * time.Second
	}
	select {
	case <-runCtx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), wait)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return nil
	case err := <-errCh:
		return err
	}
}

func checkListenAddr(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return fmt.Errorf("listen address: %w", err)
	}
	if host == "" || strings.EqualFold(host, "localhost") {
		return nil
	}
	if net.ParseIP(host) == nil {
		return fmt.Errorf("listen address host %q is not an IP", host)
	}
	return nil
}

// Public reports whether addr is reachable beyond this machine.
func Public(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host == "" {
		return true
	}
	if strings.EqualFold(host, "localhost") {
		return false
	}
	ip := net.ParseIP(host)
	return ip == nil || !ip.IsLoopback()
}

// AllowPublic refuses a non-loopback bind that has no authentication story.
// Password sign-in satisfies it. WOWROUTER_PUBLIC_BIND=token is the explicit token-only opt-in.
func AllowPublic(addr string, passwordOn, tokenOptIn bool) error {
	if !Public(addr) {
		return nil
	}
	if passwordOn || tokenOptIn {
		return nil
	}
	return errors.New("a public listen address needs password sign-in (set it in the panel or with WOWROUTER_ADMIN_PASSWORD) or WOWROUTER_PUBLIC_BIND=token")
}

// LoadFile reads a JSON config. Environment variables and flags still win.
func LoadFile(path string) (Options, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Options{}, err
	}
	var body struct {
		Addr           string   `json:"addr"`
		DataDir        string   `json:"data_dir"`
		DatabaseURL    string   `json:"database_url"`
		TLSCert        string   `json:"tls_cert"`
		TLSKey         string   `json:"tls_key"`
		TLSDomain      string   `json:"tls_domain"`
		CORSOrigins    []string `json:"cors_origins"`
		TrustedProxies string   `json:"trusted_proxies"`
		PublicBind     string   `json:"public_bind"`
		AdminEmail     string   `json:"admin_email"`
		LogFormat      string   `json:"log_format"`
		SyncPeer       string   `json:"sync_peer"`
		WebDir         string   `json:"web_dir"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return Options{}, err
	}
	return Options{
		Addr: body.Addr, DataDir: body.DataDir, DatabaseURL: body.DatabaseURL,
		TLSCert: body.TLSCert, TLSKey: body.TLSKey, TLSDomain: body.TLSDomain,
		CORSOrigins: body.CORSOrigins, TrustedProxies: body.TrustedProxies,
		PublicBind: body.PublicBind, AdminEmail: body.AdminEmail, LogFormat: body.LogFormat,
		SyncPeer: body.SyncPeer, WebDir: body.WebDir,
	}, nil
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
