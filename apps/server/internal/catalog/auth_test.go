package catalog

import "testing"

func TestModalities(t *testing.T) {
	cases := []struct {
		id, kind, in, out string
	}{
		{"gpt-4o", KindChat, "text,file,image", "text"},
		{"gpt-4o-mini", KindChat, "text,file,image", "text"},
		{"gpt-6-astra", KindChat, "text,file,image", "text"},
		{"o1-mini", KindChat, "text", "text"},
		{"o3", KindChat, "text,image", "text"},
		{"claude-opus-4-6", KindChat, "text,file,image", "text"},
		{"anthropic/claude-sonnet-4-6", KindChat, "text,file,image", "text"},
		{"gemini-2.5-pro", KindChat, "text,file,image,audio,video", "text"},
		{"gemini-2.5-flash-lite", KindChat, "text,file,image,audio", "text"},
		{"gemini-2.5-flash-image", KindChat, "text,file,image", "text,image"},
		{"grok-3", KindChat, "text", "text"},
		{"grok-4", KindChat, "text,image", "text"},
		{"phi-4", KindChat, "text", "text"},
		{"qwen2.5-vl-72b", KindChat, "text,image,video", "text"},
		{"llama-3.1-70b", KindChat, "text", "text"},
		{"sonar-deep-research", KindChat, "text", "text"},
		{"nova-micro-v1", KindChat, "text", "text"},
		{"nova-lite-v1", KindChat, "text,image", "text"},
		{"photo1", KindChat, "text", "text"},
		{"openai/gpt-audio", KindAudio, "text,audio", "text,audio"},
		{"Wan-AI/Wan2.6-T2I", KindVideo, "text", "image"},
		{"whisper-1", KindAudio, "audio", "text"},
		{"gpt-4o-mini-tts", KindAudio, "text", "audio"},
		{"dall-e-3", KindImage, "text", "image"},
		{"gpt-image-1", KindImage, "text,image", "image"},
		{"sora-2", KindVideo, "text", "video"},
		{"kling-i2v", KindVideo, "text,image", "video"},
		{"gemini-embedding-2", KindEmbedding, "text", "embedding"},
		{"text-embedding-3-small", KindEmbedding, "text", "embedding"},
	}
	for _, tc := range cases {
		in, out := Modalities(tc.id, tc.kind)
		if in != tc.in || out != tc.out {
			t.Fatalf("%s %s: got %s -> %s, want %s -> %s", tc.id, tc.kind, in, out, tc.in, tc.out)
		}
	}
	if got := NormalizeModalities([]string{"text", "pdf", "image"}); got != "text,file,image" {
		t.Fatal(got)
	}
	facts := LookupFacts("openai/gpt-4o")
	if facts.ContextWindow != 128_000 || facts.InputUSDPerMillion != 2.5 || facts.OutputUSDPerMillion != 10 {
		t.Fatalf("gpt-4o facts %+v", facts)
	}
}

func TestUsesSessionCookie(t *testing.T) {
	if !UsesSessionCookie("grok-web") || !UsesSessionCookie("zenmux-free") {
		t.Fatal("cookie providers")
	}
	if UsesSessionCookie("openai") || UsesSessionCookie("adapta-web") || UsesSessionCookie("zai-web") || UsesSessionCookie("deepseek-web") {
		t.Fatal("these secrets travel as bearer tokens")
	}
}
