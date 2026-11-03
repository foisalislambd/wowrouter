package awsig

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSignNamesTheKeyAndRegion(t *testing.T) {
	req, err := http.NewRequest(http.MethodPost, "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions", strings.NewReader(`{"model":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	cred, ok := Parse("AKIDEXAMPLE:secret", "us-east-1")
	if !ok {
		t.Fatal("parse")
	}
	Sign(req, cred, []byte(`{"model":"x"}`), time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	auth := req.Header.Get("Authorization")
	if !strings.Contains(auth, "Credential=AKIDEXAMPLE/20260102/us-east-1/bedrock/aws4_request") {
		t.Fatal(auth)
	}
	if !strings.Contains(auth, "SignedHeaders=host;x-amz-content-sha256;x-amz-date") || !strings.Contains(auth, "Signature=") {
		t.Fatal(auth)
	}
}

func TestParseSessionToken(t *testing.T) {
	cred, ok := Parse("AKIA:secret:token:part", "")
	if !ok || cred.SessionToken != "token:part" || cred.Region != "us-east-1" {
		t.Fatalf("%+v %v", cred, ok)
	}
	if RegionFromHost("bedrock-runtime.eu-west-1.amazonaws.com") != "eu-west-1" {
		t.Fatal("region")
	}
}
