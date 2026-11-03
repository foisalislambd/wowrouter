//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/windows/registry"
)

func setStartWithWindows(on bool) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if !on {
		if err = deleteRunValue(key, "WowRouter"); err != nil {
			return err
		}
		return deleteRunValue(key, "AIRoute")
	}
	if err = deleteRunValue(key, "AIRoute"); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return key.SetStringValue("WowRouter", fmt.Sprintf(`"%s" --agent`, exe))
}

func deleteRunValue(key registry.Key, name string) error {
	err := key.DeleteValue(name)
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	return err
}
