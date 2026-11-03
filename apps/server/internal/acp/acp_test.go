package acp

import (
	"bytes"
	"strings"
	"testing"
)

func TestInitialize(t *testing.T) {
	var out bytes.Buffer
	err := Run(strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\n"), &out, "http://127.0.0.1:9", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "protocolVersion") {
		t.Fatal(out.String())
	}
}
