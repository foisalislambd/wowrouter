package catalog

import "strings"

// modalityOrder is the display order for comma-separated modality lists.
var modalityOrder = []string{"text", "file", "image", "audio", "video", "embedding", "decisions"}

// NormalizeModalities maps provider labels onto the names the panel shows.
// An empty result means the provider did not say.
func NormalizeModalities(values []string) string {
	flags := map[string]bool{}
	for _, value := range values {
		for _, part := range splitModality(value) {
			if name, ok := canonicalModality(part); ok {
				flags[name] = true
			}
		}
	}
	return formatModalities(flags)
}

func modalitiesFor(name, kind string) (string, string) {
	switch kind {
	case KindImage:
		in := map[string]bool{"text": true}
		if containsAny(name, "edit", "i2i", "img2img", "inpaint", "variation", "image-to-image", "gpt-image", "kontext") {
			in["image"] = true
		}
		return formatModalities(in), "image"
	case KindVideo:
		if containsAny(name, "t2i", "text-to-image", "text2img") && !containsAny(name, "t2v", "i2v") {
			return "text", "image"
		}
		in := map[string]bool{"text": true}
		if containsAny(name, "i2v", "img2vid", "image-to-video", "r2v") || strings.Contains(name, "image") {
			in["image"] = true
		}
		if containsAny(name, "v2v", "video-to-video") {
			in["video"] = true
		}
		return formatModalities(in), "video"
	case KindAudio:
		if containsAny(name, "whisper", "transcri", "stt", "asr", "speech-to-text") {
			return "audio", "text"
		}
		if containsAny(name, "gpt-audio", "audio-preview", "-omni") || strings.Contains(name, "realtime") {
			return "text,audio", "text,audio"
		}
		return "text", "audio"
	case KindEmbedding:
		in := map[string]bool{"text": true}
		if containsAny(name, "clip", "siglip", "multimodal") {
			in["image"] = true
		}
		return formatModalities(in), "embedding"
	case KindDecision:
		return "text", "decisions"
	case KindSearch:
		return "text", "text"
	default:
		return chatModalities(name)
	}
}

func chatModalities(name string) (string, string) {
	in := map[string]bool{"text": true}
	out := map[string]bool{"text": true}
	if acceptsImage(name) {
		in["image"] = true
	}
	if acceptsFile(name) {
		in["file"] = true
	}
	if acceptsAudio(name) {
		in["audio"] = true
	}
	if acceptsVideo(name) {
		in["video"] = true
	}
	if emitsImage(name) {
		out["image"] = true
	}
	if emitsAudio(name) {
		out["audio"] = true
	}
	return formatModalities(in), formatModalities(out)
}

func acceptsImage(name string) bool {
	if containsAny(name,
		"vision", "-vl", "vl-", "llava", "pixtral", "moondream", "internvl",
		"minicpm-v", "cogvlm", "yi-vl", "deepseek-vl", "qvq",
		"gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision", "chatgpt-4o",
		"gpt-5", "gpt-6",
		"claude-3", "claude-opus", "claude-sonnet", "claude-haiku", "claude-fable",
		"gemini",
		"gemma-3", "gemma3", "gemma-4",
		"llama-4", "llama4", "llama-3.2-11b", "llama-3.2-90b",
		"qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl", "qwen-omni", "qwen2.5-omni", "qwen3-omni",
		"grok-vision", "grok-4", "grok-2-vision",
		"phi-3-vision", "phi-4-multimodal", "phi4-multimodal",
		"command-a",
		"nova-pro", "nova-lite", "nova-premier", "nova-2",
		"glm-4v", "glm-4.5v", "glm-4.6v", "glm-4.1v", "glm-4.7v",
		"step-1v", "step-3v",
		"mistral-small-3", "mistral-medium", "mistral-small-250",
	) {
		return true
	}
	if (hasToken(name, "o1") || hasToken(name, "o3") || hasToken(name, "o4")) && !hasToken(name, "o1-mini") && !hasToken(name, "o3-mini") {
		return true
	}
	return strings.Contains(name, "-image") && !containsAny(name, "image-to-text", "img2text")
}

func acceptsFile(name string) bool {
	return containsAny(name,
		"claude-3", "claude-opus", "claude-sonnet", "claude-haiku", "claude-fable",
		"gemini",
		"gpt-4o", "gpt-4.1", "gpt-5", "gpt-6",
		"command-a",
	)
}

func acceptsAudio(name string) bool {
	if strings.Contains(name, "gemini") && !containsAny(name, "imagen", "embed", "tts", "image") {
		return true
	}
	return containsAny(name,
		"gpt-4o-audio", "gpt-4o-realtime", "gpt-audio", "gpt-realtime", "audio-preview",
		"qwen-audio", "qwen2-audio", "qwen2.5-omni", "qwen3-omni", "qwen-omni",
		"phi-4-multimodal", "phi4-multimodal",
		"nova-sonic", "-omni",
	)
}

func acceptsVideo(name string) bool {
	if strings.Contains(name, "gemini") && !containsAny(name, "imagen", "embed", "tts", "lite", "image") {
		return true
	}
	return containsAny(name,
		"qwen2.5-vl", "qwen2-vl", "qwen3-vl", "qwen-vl",
		"qwen2.5-omni", "qwen3-omni", "qwen-omni", "-omni",
		"video-preview",
	)
}

func emitsImage(name string) bool {
	if containsAny(name, "image-to-text", "img2text") {
		return false
	}
	return containsAny(name, "image-preview", "-image", "image-gen")
}

func emitsAudio(name string) bool {
	return containsAny(name, "gpt-4o-audio", "gpt-4o-realtime", "gpt-audio", "gpt-realtime", "audio-preview", "-omni")
}

func modelName(id string) string {
	name := strings.ToLower(strings.TrimSpace(id))
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	return name
}

func hasToken(name, token string) bool {
	for start := 0; start < len(name); {
		i := strings.Index(name[start:], token)
		if i < 0 {
			return false
		}
		i += start
		before := i == 0 || !isAlphaNum(name[i-1])
		end := i + len(token)
		after := end == len(name) || !isAlphaNum(name[end])
		if before && after {
			return true
		}
		start = i + 1
	}
	return false
}

func isAlphaNum(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9')
}

func containsAny(value string, parts ...string) bool {
	for _, part := range parts {
		if part != "" && strings.Contains(value, part) {
			return true
		}
	}
	return false
}

func canonicalModality(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "text", "txt":
		return "text", true
	case "image", "images", "img", "vision":
		return "image", true
	case "audio", "speech", "sound":
		return "audio", true
	case "video":
		return "video", true
	case "file", "files", "pdf", "document", "documents":
		return "file", true
	case "embedding", "embeddings":
		return "embedding", true
	case "decision", "decisions":
		return "decisions", true
	default:
		return "", false
	}
}

func splitModality(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '+' || r == '|' || r == '/' || r == ' '
	})
}

func formatModalities(flags map[string]bool) string {
	if len(flags) == 0 {
		return ""
	}
	parts := make([]string, 0, len(flags))
	for _, name := range modalityOrder {
		if flags[name] {
			parts = append(parts, name)
		}
	}
	return strings.Join(parts, ",")
}
