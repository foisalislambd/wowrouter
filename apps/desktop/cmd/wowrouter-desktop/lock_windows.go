//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutexW = kernel32.NewProc("CreateMutexW")
	procSetLastError = kernel32.NewProc("SetLastError")
)

func acquireAgentLock() (func(), bool) {
	return acquireNamedLock(`Local\AIRoute.Agent`)
}

func acquireUILock() (func(), bool) {
	return acquireNamedLock(`Local\AIRoute.UI`)
}

func acquireNamedLock(raw string) (func(), bool) {
	name, err := syscall.UTF16PtrFromString(raw)
	if err != nil {
		return func() {}, false
	}
	_, _, _ = procSetLastError.Call(0)
	handle, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return func() {}, false
	}
	if errno, ok := callErr.(syscall.Errno); ok && errno == 183 {
		_ = syscall.CloseHandle(syscall.Handle(handle))
		return func() {}, false
	}
	return func() {
		_ = syscall.CloseHandle(syscall.Handle(handle))
	}, true
}
