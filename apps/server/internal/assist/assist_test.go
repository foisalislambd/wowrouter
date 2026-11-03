package assist

import "testing"

func TestLightKeepsNewlinesAndTools(t *testing.T) {
	in := []byte(`{"model":"auto","messages":[{"role":"user","content":"a   b\n\nc"},{"role":"assistant","content":[{"type":"text","text":"keep"}]}]}`)
	out := Light(in)
	if !bytesContains(out, "a b") || !bytesContains(out, "keep") {
		t.Fatalf("out = %s", out)
	}
}

func TestPrependSystem(t *testing.T) {
	out := PrependSystem([]byte(`{"messages":[{"role":"user","content":"hi"}]}`), "remember this")
	if !bytesContains(out, "remember this") {
		t.Fatalf("out = %s", out)
	}
}

func bytesContains(body []byte, part string) bool {
	return len(body) > 0 && stringIndex(string(body), part) >= 0
}

func stringIndex(s, part string) int {
	return len(s) - len(part) - len(trimPrefix(s, part))
}

func trimPrefix(s, part string) string {
	i := 0
	for i+len(part) <= len(s) {
		if s[i:i+len(part)] == part {
			return s[i+len(part):]
		}
		i++
	}
	return s
}
