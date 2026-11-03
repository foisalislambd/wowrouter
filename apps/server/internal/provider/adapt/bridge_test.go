package adapt

import (
	"strings"
	"testing"
)

func TestGitLabAndClovaAndAgentShapes(t *testing.T) {
	body := []byte(`{"model":"gitlab-duo/duo","messages":[{"role":"user","content":"add a test"}],"stream":false}`)
	git := GitLab("https://gitlab.com/api/v4", "pat", body)
	if !strings.HasSuffix(git.URL, "/code_suggestions/completions") || !strings.Contains(string(git.Body), "add a test") {
		t.Fatalf("%s %s", git.URL, git.Body)
	}
	clova := Clova("https://clovastudio.stream.ntruss.com/v3", "key", []byte(`{"model":"clova-studio/HCX-005","messages":[{"role":"user","content":"hi"}]}`))
	if !strings.Contains(clova.URL, "/chat-completions/HCX-005") {
		t.Fatal(clova.URL)
	}
	jules := Agent("jules", "https://jules.googleapis.com", "jkey", "write tests")
	if jules.Header.Get("x-goog-api-key") != "jkey" || !strings.Contains(jules.URL, "/v1alpha/sessions") {
		t.Fatalf("%+v", jules)
	}
	if Text([]byte(`{"choices":[{"text":"from gitlab"}]}`)) != "from gitlab" {
		t.Fatal("gitlab text")
	}
	if Text([]byte("event: token\ndata: {\"message\":{\"content\":\"hel\"}}\n\ndata: {\"message\":{\"content\":\"lo\"}}\n")) != "hello" {
		t.Fatal("sse")
	}
	comfy := Comfy("http://127.0.0.1:8188", "a cat")
	if !strings.Contains(string(comfy.Body), "CLIPTextEncode") || !strings.Contains(string(comfy.Body), "a cat") {
		t.Fatal(string(comfy.Body))
	}
	if Text([]byte(`{"prompt_id":"abc"}`)) != "queued abc" {
		t.Fatal("prompt id")
	}
}

func TestBedrockRejectsAPlainKey(t *testing.T) {
	_, err := Bedrock("https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1", "not-a-pair", []byte(`{"model":"amazon.nova","messages":[]}`))
	if err == nil {
		t.Fatal("expected a key format error")
	}
}
