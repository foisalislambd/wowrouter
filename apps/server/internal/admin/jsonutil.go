package admin

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func nowRFC() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return ""
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f
	case int:
		return float64(t)
	default:
		return 0
	}
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func cloneMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(in)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func mergePatch(base, patch map[string]any) map[string]any {
	out := cloneMap(base)
	for k, v := range patch {
		if v == nil {
			delete(out, k)
			continue
		}
		child, ok := v.(map[string]any)
		if !ok {
			out[k] = v
			continue
		}
		prev, _ := out[k].(map[string]any)
		out[k] = mergePatch(prev, child)
	}
	return out
}

func decodeJSON(raw []byte) (any, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, nil
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

func randomToken(prefix string, n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(buf), nil
}

func shaHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func money(v float64) string { return fmt.Sprintf("%.6f", v) }

var secretFields = map[string]struct{}{
	"api_key": {}, "secret": {}, "client_secret": {}, "password": {},
	"signing_secret": {}, "hmac_secret": {}, "access_key": {}, "secret_access_key": {},
	"token": {}, "bootstrap_token": {}, "bearer_token": {},
}

func redactTree(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, child := range t {
			if _, secret := secretFields[k]; secret {
				if s := asString(child); s != "" && s != "[REDACTED]" {
					out[k] = "[REDACTED]"
					continue
				}
			}
			out[k] = redactTree(child)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, child := range t {
			out[i] = redactTree(child)
		}
		return out
	default:
		return v
	}
}

// keepSecrets copies secret fields from previous when the incoming value is blank or already redacted.
func keepSecrets(prev, next any) any {
	pm, okp := prev.(map[string]any)
	nm, okn := next.(map[string]any)
	if !okp || !okn {
		return next
	}
	out := cloneMap(nm)
	for k, nv := range nm {
		pv, had := pm[k]
		if _, secret := secretFields[k]; secret {
			s := asString(nv)
			if s == "" || s == "[REDACTED]" {
				if had {
					out[k] = pv
				} else {
					delete(out, k)
				}
				continue
			}
		}
		if child, ok := nv.(map[string]any); ok {
			out[k] = keepSecrets(pv, child)
		}
	}
	for k, pv := range pm {
		if _, secret := secretFields[k]; !secret {
			continue
		}
		if _, present := out[k]; !present {
			out[k] = pv
		}
	}
	return out
}
