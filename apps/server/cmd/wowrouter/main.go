package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"wowrouter/server/app"
	"wowrouter/server/internal/cli"
)

func main() {
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		os.Exit(cli.Run(os.Args[1:]))
	}
	configPath := flag.String("config", os.Getenv("WOWROUTER_CONFIG"), "JSON config file")
	addr := flag.String("addr", "", "listen address (default 127.0.0.1:8787)")
	dataDir := flag.String("data", "", "directory for the database and secret key")
	webDir := flag.String("web", "", "built panel directory")
	consoleDir := flag.String("console", "", "built gateway console directory")
	flag.Parse()

	opt := app.Options{}
	if *configPath != "" {
		loaded, err := app.LoadFile(*configPath)
		if err != nil {
			log.Fatal(err)
		}
		opt = loaded
	}
	opt.Addr = first(*addr, os.Getenv("WOWROUTER_ADDR"), opt.Addr, "127.0.0.1:8787")
	opt.DataDir = first(*dataDir, os.Getenv("WOWROUTER_DATA"), opt.DataDir)
	opt.WebDir = first(*webDir, os.Getenv("WOWROUTER_WEB"), opt.WebDir)
	opt.ConsoleDir = first(*consoleDir, opt.ConsoleDir)
	opt.DatabaseURL = first(os.Getenv("WOWROUTER_DATABASE_URL"), opt.DatabaseURL)
	opt.TLSCert = first(os.Getenv("WOWROUTER_TLS_CERT"), opt.TLSCert)
	opt.TLSKey = first(os.Getenv("WOWROUTER_TLS_KEY"), opt.TLSKey)
	opt.TLSDomain = first(os.Getenv("WOWROUTER_TLS_DOMAIN"), opt.TLSDomain)
	opt.TrustedProxies = first(os.Getenv("WOWROUTER_TRUSTED_PROXIES"), opt.TrustedProxies)
	opt.PublicBind = first(os.Getenv("WOWROUTER_PUBLIC_BIND"), opt.PublicBind)
	opt.AdminPassword = os.Getenv("WOWROUTER_ADMIN_PASSWORD")
	opt.AdminEmail = first(os.Getenv("WOWROUTER_ADMIN_EMAIL"), opt.AdminEmail, "admin@localhost")
	opt.LogFormat = first(os.Getenv("WOWROUTER_LOG_FORMAT"), opt.LogFormat)
	opt.SyncPeer = first(os.Getenv("WOWROUTER_SYNC_PEER"), opt.SyncPeer)
	opt.SyncToken = os.Getenv("WOWROUTER_SYNC_TOKEN")
	if raw := os.Getenv("WOWROUTER_CORS_ORIGINS"); raw != "" {
		opt.CORSOrigins = splitComma(raw)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := app.Run(ctx, opt); err != nil {
		log.Fatal(err)
	}
}

func first(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func splitComma(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
