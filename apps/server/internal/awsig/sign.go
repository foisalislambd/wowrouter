// Package awsig signs Bedrock requests with AWS Signature Version 4.
package awsig

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Credentials are a long-lived or temporary AWS key.
type Credentials struct {
	AccessKey    string
	SecretKey    string
	SessionToken string
	Region       string
}

// Parse splits access:secret or access:secret:token.
func Parse(raw, region string) (Credentials, bool) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return Credentials{}, false
	}
	cred := Credentials{AccessKey: parts[0], SecretKey: parts[1], Region: region}
	if len(parts) > 2 {
		cred.SessionToken = strings.Join(parts[2:], ":")
	}
	if cred.Region == "" {
		cred.Region = "us-east-1"
	}
	return cred, true
}

// RegionFromHost reads us-east-1 from bedrock-runtime.us-east-1.amazonaws.com.
func RegionFromHost(host string) string {
	host = strings.Split(host, ":")[0]
	parts := strings.Split(host, ".")
	if len(parts) >= 3 && parts[0] == "bedrock-runtime" {
		return parts[1]
	}
	return "us-east-1"
}

// Sign sets the Authorization header on req. Payload is the exact body bytes.
func Sign(req *http.Request, cred Credentials, payload []byte, now time.Time) {
	if cred.Region == "" {
		cred.Region = "us-east-1"
	}
	amz := now.UTC().Format("20060102T150405Z")
	date := amz[:8]
	payloadHash := hex.EncodeToString(hash(payload))
	req.Header.Set("x-amz-date", amz)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	if cred.SessionToken != "" {
		req.Header.Set("x-amz-security-token", cred.SessionToken)
	}
	if req.Header.Get("Host") == "" && req.URL != nil {
		req.Header.Set("Host", req.URL.Host)
	}
	signed := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	if cred.SessionToken != "" {
		signed = append(signed, "x-amz-security-token")
	}
	sort.Strings(signed)
	var canonical strings.Builder
	canonical.WriteString(req.Method)
	canonical.WriteByte('\n')
	path := req.URL.EscapedPath()
	if path == "" {
		path = "/"
	}
	canonical.WriteString(path)
	canonical.WriteByte('\n')
	canonical.WriteString(req.URL.RawQuery)
	canonical.WriteByte('\n')
	for _, name := range signed {
		canonical.WriteString(name)
		canonical.WriteByte(':')
		canonical.WriteString(strings.TrimSpace(req.Header.Get(headerName(name))))
		canonical.WriteByte('\n')
	}
	canonical.WriteByte('\n')
	canonical.WriteString(strings.Join(signed, ";"))
	canonical.WriteByte('\n')
	canonical.WriteString(payloadHash)
	scope := date + "/" + cred.Region + "/bedrock/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amz + "\n" + scope + "\n" + hex.EncodeToString(hash([]byte(canonical.String())))
	key := hmacSHA([]byte("AWS4"+cred.SecretKey), date)
	key = hmacSHA(key, cred.Region)
	key = hmacSHA(key, "bedrock")
	key = hmacSHA(key, "aws4_request")
	sig := hex.EncodeToString(hmacSHA(key, stringToSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+cred.AccessKey+"/"+scope+", SignedHeaders="+strings.Join(signed, ";")+", Signature="+sig)
}

func headerName(lower string) string {
	switch lower {
	case "host":
		return "Host"
	default:
		return lower
	}
}

func hash(in []byte) []byte {
	sum := sha256.Sum256(in)
	return sum[:]
}

func hmacSHA(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
