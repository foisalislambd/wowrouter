package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"airoute/server/app"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "local address to listen on")
	dataDir := flag.String("data", "", "directory for the SQLite database and secret key")
	webDir := flag.String("web", "", "built panel directory")
	consoleDir := flag.String("console", "", "built gateway console directory")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := app.Run(ctx, app.Options{
		Addr:       *addr,
		DataDir:    *dataDir,
		WebDir:     *webDir,
		ConsoleDir: *consoleDir,
	}); err != nil {
		log.Fatal(err)
	}
}
