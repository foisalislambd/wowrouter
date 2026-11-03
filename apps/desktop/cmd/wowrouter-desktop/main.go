package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"airoute/server/app"
	"airoute/server/desktoppref"
)

func main() {
	setupLog()
	address := listenAddr()
	mode := ""
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--ui":
			mode = "ui"
		case "--agent":
			mode = "agent"
		}
	}
	var err error
	switch mode {
	case "ui":
		if !app.Probe(address) {
			err = errors.New("WowRouter is not running.")
			break
		}
		err = openWindow("http://" + address)
	case "agent":
		err = runAgent(address, false)
	default:
		if app.Probe(address) {
			err = openWindow("http://" + address)
			break
		}
		err = runAgent(address, true)
	}
	if err != nil {
		showError(err)
		os.Exit(1)
	}
}

func listenAddr() string {
	for _, key := range []string{"WOWROUTER_ADDR", "AIROUTE_ADDR"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return "127.0.0.1:8787"
}

func launchUI() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "--ui")
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

var prefMu sync.Mutex

func updateStart(dir string, on bool) error {
	prefMu.Lock()
	defer prefMu.Unlock()
	if err := desktoppref.Save(dir, desktoppref.Pref{StartWithWindows: on}); err != nil {
		return err
	}
	return setStartWithWindows(on)
}

func runAgent(address string, openUI bool) error {
	if app.Probe(address) {
		if openUI {
			return openWindow("http://" + address)
		}
		return nil
	}
	release, ok := acquireAgentLock()
	if !ok {
		if !openUI {
			return nil
		}
		if !waitReady(address) {
			return errors.New("WowRouter is already starting, but it did not become ready.")
		}
		return openWindow("http://" + address)
	}
	defer release()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ready := make(chan struct{})
	errCh := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		errCh <- app.Run(ctx, app.Options{
			Addr: address,
			OnReady: func() {
				close(ready)
			},
		})
		close(done)
	}()
	select {
	case err := <-errCh:
		if err != nil {
			return err
		}
		return nil
	case <-ready:
	}

	dir, err := app.DefaultDataDir()
	if err != nil {
		stop()
		<-done
		return err
	}
	if !desktoppref.Exists(dir) {
		if err := desktoppref.Save(dir, desktoppref.Pref{StartWithWindows: true}); err != nil {
			showError(err)
		}
	}
	pref := desktoppref.Load(dir)
	if err := setStartWithWindows(pref.StartWithWindows); err != nil {
		showError(err)
	}
	if openUI {
		if err := launchUI(); err != nil {
			showError(err)
		}
	}
	watchCtx, watchStop := context.WithCancel(ctx)
	defer watchStop()
	go watchPref(watchCtx, dir, pref.StartWithWindows)
	runTray(pref.StartWithWindows, launchUI, func(on bool) {
		if err := updateStart(dir, on); err != nil {
			showError(err)
		}
	}, func() {
		watchStop()
		stop()
	}, errCh)
	stop()
	select {
	case <-done:
	case <-time.After(6 * time.Second):
	}
	return nil
}

func waitReady(address string) bool {
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if app.Probe(address) {
			return true
		}
		time.Sleep(150 * time.Millisecond)
	}
	return false
}

func watchPref(ctx context.Context, dir string, current bool) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			prefMu.Lock()
			next := desktoppref.Load(dir).StartWithWindows
			if next == current {
				prefMu.Unlock()
				continue
			}
			err := setStartWithWindows(next)
			prefMu.Unlock()
			if err != nil {
				showError(err)
				current = next
				continue
			}
			current = next
			setTrayStart(next)
		}
	}
}
