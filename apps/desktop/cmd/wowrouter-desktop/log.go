package main

import (
	"log"
	"os"
	"path/filepath"

	"airoute/server/app"
)

func setupLog() {
	dir, err := app.DefaultDataDir()
	if err != nil {
		return
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	path := filepath.Join(dir, "agent.log")
	if info, statErr := os.Stat(path); statErr == nil && info.Size() > 512*1024 {
		_ = os.Rename(path, path+".old")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	log.SetOutput(file)
}
