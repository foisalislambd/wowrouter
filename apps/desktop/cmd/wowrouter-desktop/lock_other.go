//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"syscall"

	"airoute/server/app"
)

func acquireAgentLock() (func(), bool) {
	return acquireFileLock("agent.lock")
}

func acquireUILock() (func(), bool) {
	return acquireFileLock("ui.lock")
}

func acquireFileLock(name string) (func(), bool) {
	dir, err := app.DefaultDataDir()
	if err != nil {
		return func() {}, false
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return func() {}, false
	}
	file, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return func() {}, false
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return func() {}, false
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, true
}
