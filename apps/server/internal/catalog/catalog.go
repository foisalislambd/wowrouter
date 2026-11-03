package catalog

import "strings"

// Model is one chat model a provider can expose through the router.
// Prices are standard-tier USD per 1M tokens from the provider docs.
type Model struct {
	UpstreamID          string
	DisplayName         string
	Description         string
	ContextWindow       int
	MaxOutputTokens     int
	InputUSDPerMillion  float64
	OutputUSDPerMillion float64
	KnowledgeCutoff     string
	Reasoning           bool
	Kind                string
}

// Provider is a built-in provider definition. User secrets live in SQLite,
// not in this catalog.
type Provider struct {
	Slug           string
	DisplayName    string
	Protocol       string
	DefaultBaseURL string
	DocsURL        string
	Summary        string
	Category       string
	Free           bool
	KeyOptional    bool
	AnonymousKey   string
	Models         []Model
}

const (
	ProtocolOpenAIChat  = "openai_chat"
	ProtocolAnthropic   = "anthropic_messages"
	ProtocolGemini      = "gemini_generate"
	ProtocolOllama      = "ollama_chat"
	ProtocolCohere      = "cohere_chat"
	ProtocolSearch      = "search"
	ProtocolEmbedding   = "embedding"
	ProtocolAudio       = "audio_speech"
	ProtocolMedia       = "native_media"
	ProtocolSDWebUI     = "sdwebui"
	ProtocolSystemOne   = "systemone"
	ProtocolUnsupported = "unsupported"
	KindChat            = "chat"
	KindImage           = "image"
	KindVideo           = "video"
	KindAudio           = "audio"
	KindEmbedding       = "embedding"
	KindSearch          = "search"
	KindDecision        = "decisions"
)

func All() []Provider {
	providers := append(append([]Provider{OpenAI()}, generatedProviders()...), decisionProviders()...)
	return append(providers, nocostProviders()...)
}

// KindFromID guesses a model kind from an upstream id returned by a model list.
func KindFromID(id string) string {
	name := modelName(id)
	switch {
	case strings.Contains(name, "embed") || containsAny(name, "rerank", "voyage"):
		return KindEmbedding
	case containsAny(name, "whisper", "tts", "transcri", "speech"):
		return KindAudio
	case containsAny(name, "dall-e", "gpt-image", "flux", "stable-diffusion", "imagen", "sdxl", "ideogram", "recraft", "kandinsky", "kolors", "midjourney", "hidream", "qwen-image", "nano-banana", "t2i", "text2img", "text-to-image"):
		return KindImage
	case containsAny(name, "sora", "veo", "kling", "runway", "luma", "hailuo", "cogvideo", "mochi", "i2v", "t2v", "r2v", "seedance", "wan-", "wan/"):
		return KindVideo
	default:
		return KindChat
	}
}

// UsesSessionCookie reports providers whose session secret is sent as a Cookie header.
// Other web-session providers still use Authorization: Bearer for that same saved secret.
func UsesSessionCookie(slug string) bool {
	switch slug {
	case "blackbox-web", "chatgpt-web", "chatgpt-web-codex", "claude-web",
		"conol-web", "copilot-m365-web", "copilot-web", "doubao-web", "gemini-web",
		"grok-web", "huggingchat", "hyperagent", "lmarena", "muse-spark-web",
		"notion-web", "perplexity-web", "t3-web", "tencent-aistudio-web",
		"yuanbao-web", "zenmux-free":
		return true
	default:
		return false
	}
}

// Modalities reports what a model accepts and what it returns.
// Values are comma-separated: text, file, image, audio, video, embedding, decisions.
func Modalities(id, kind string) (string, string) {
	return modalitiesFor(modelName(id), kind)
}

func BySlug(slug string) (Provider, bool) {
	for _, provider := range All() {
		if provider.Slug == slug {
			return provider, true
		}
	}
	return Provider{}, false
}

func OpenAI() Provider {
	return Provider{
		Slug:           "openai",
		DisplayName:    "OpenAI",
		Protocol:       ProtocolOpenAIChat,
		DefaultBaseURL: "https://api.openai.com/v1",
		DocsURL:        "https://developers.openai.com/api/docs/models",
		Summary:        "Official OpenAI chat API. Requests use your key on this computer.",
		Category:       "Frontier",
		Models: []Model{
			{
				UpstreamID:          "gpt-6-astra",
				DisplayName:         "GPT-6 Astra",
				Description:         "Flagship model for complex reasoning and coding.",
				ContextWindow:       1_050_000,
				MaxOutputTokens:     128_000,
				InputUSDPerMillion:  10,
				OutputUSDPerMillion: 50,
				KnowledgeCutoff:     "2026-04-30",
				Reasoning:           true,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-6.1-sol",
				DisplayName:         "GPT-6.1 Sol",
				Description:         "Near-flagship quality for complex work at a lower cost.",
				ContextWindow:       1_050_000,
				MaxOutputTokens:     128_000,
				InputUSDPerMillion:  2,
				OutputUSDPerMillion: 10,
				KnowledgeCutoff:     "2026-04-30",
				Reasoning:           true,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-6-luna",
				DisplayName:         "GPT-6 Luna",
				Description:         "Efficient model for focused, high-volume tasks.",
				ContextWindow:       1_050_000,
				MaxOutputTokens:     128_000,
				InputUSDPerMillion:  0.10,
				OutputUSDPerMillion: 0.50,
				KnowledgeCutoff:     "2026-05-18",
				Reasoning:           true,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-5.6-sol",
				DisplayName:         "GPT-5.6 Sol",
				Description:         "GPT-5.6 flagship tier. The gpt-5.6 alias points here.",
				ContextWindow:       1_050_000,
				MaxOutputTokens:     128_000,
				InputUSDPerMillion:  4,
				OutputUSDPerMillion: 20,
				KnowledgeCutoff:     "2026-02-16",
				Reasoning:           true,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-5.6-terra",
				DisplayName:         "GPT-5.6 Terra",
				Description:         "Balances intelligence and cost in the GPT-5.6 family.",
				ContextWindow:       1_050_000,
				MaxOutputTokens:     128_000,
				InputUSDPerMillion:  2,
				OutputUSDPerMillion: 12,
				KnowledgeCutoff:     "2026-02-16",
				Reasoning:           true,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-5.6-luna",
				DisplayName:         "GPT-5.6 Luna",
				Description:         "Cost-sensitive, high-volume GPT-5.6 tier.",
				ContextWindow:       1_050_000,
				MaxOutputTokens:     128_000,
				InputUSDPerMillion:  0.20,
				OutputUSDPerMillion: 1.20,
				KnowledgeCutoff:     "2026-02-16",
				Reasoning:           true,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-4o",
				DisplayName:         "GPT-4o",
				Description:         "Previous omni model with text and image input.",
				ContextWindow:       128_000,
				MaxOutputTokens:     16_384,
				InputUSDPerMillion:  2.50,
				OutputUSDPerMillion: 10,
				KnowledgeCutoff:     "2023-10-01",
				Reasoning:           false,
				Kind:                KindChat,
			},
			{
				UpstreamID:          "gpt-4o-mini",
				DisplayName:         "GPT-4o mini",
				Description:         "Small, inexpensive GPT-4o for focused tasks.",
				ContextWindow:       128_000,
				MaxOutputTokens:     16_384,
				InputUSDPerMillion:  0.15,
				OutputUSDPerMillion: 0.60,
				KnowledgeCutoff:     "2023-10-01",
				Reasoning:           false,
				Kind:                KindChat,
			},
			{
				UpstreamID:  "gpt-image-1",
				DisplayName: "GPT Image 1",
				Description: "OpenAI image generation.",
				Kind:        KindImage,
			},
			{
				UpstreamID:  "dall-e-3",
				DisplayName: "DALL·E 3",
				Description: "OpenAI image generation.",
				Kind:        KindImage,
			},
			{
				UpstreamID:  "dall-e-2",
				DisplayName: "DALL·E 2",
				Description: "OpenAI image generation.",
				Kind:        KindImage,
			},
			{
				UpstreamID:  "sora-2",
				DisplayName: "Sora 2",
				Description: "OpenAI video generation.",
				Kind:        KindVideo,
			},
		},
	}
}

// decisionProviders are System One decision models. A request sends state plus
// typed questions and the model returns calibrated answers, not chat text.
func decisionProviders() []Provider {
	return []Provider{
		{
			Slug:           "typesafe",
			DisplayName:    "TypeSafe",
			Protocol:       ProtocolSystemOne,
			DefaultBaseURL: "https://api.typesafe.ai/v1",
			DocsURL:        "https://api.typesafe.ai/v1/systemone",
			Summary:        "Jev System One decisions. POST /systemone with state and questions. Answers are a choice, a score, or a yes/no probability.",
			Category:       "Decisions",
			Models: []Model{
				{
					UpstreamID:          "jev-1.13",
					DisplayName:         "Jev 1.13",
					Description:         "Returns answers keyed by your question ids. A noul answer is a probability from 0 to 1. A choice answer names the winning option and its probabilities.",
					ContextWindow:       32000,
					InputUSDPerMillion:  0.042,
					OutputUSDPerMillion: 0,
					Kind:                KindDecision,
				},
				{
					UpstreamID:          "jev-latest",
					DisplayName:         "Jev Latest",
					Description:         "Alias of the current Jev System One model. The response model field names the version that answered.",
					ContextWindow:       32000,
					InputUSDPerMillion:  0.042,
					OutputUSDPerMillion: 0,
					Kind:                KindDecision,
				},
			},
		},
		{
			Slug:           "respan",
			DisplayName:    "Respan",
			Protocol:       ProtocolSystemOne,
			DefaultBaseURL: "",
			DocsURL:        "https://openrouter.ai/models?output_modalities=decisions",
			Summary:        "Span scores each behavior you name. Paste the System One base URL, then POST /systemone. The answer is a probability, not generated text.",
			Category:       "Decisions",
			Models: []Model{
				{
					UpstreamID:          "span-01",
					DisplayName:         "Span-01",
					Description:         "Reads a conversation span and returns the probability that each behavior you define is present.",
					InputUSDPerMillion:  0.02,
					OutputUSDPerMillion: 0,
					Kind:                KindDecision,
				},
				{
					UpstreamID:          "span-01-lite",
					DisplayName:         "Span-01 Lite",
					Description:         "Lighter Span model. Same probability answers, for higher volume.",
					InputUSDPerMillion:  0,
					OutputUSDPerMillion: 0,
					Kind:                KindDecision,
				},
			},
		},
		{
			Slug:           "jaredpalmer",
			DisplayName:    "Jared Palmer",
			Protocol:       ProtocolSystemOne,
			DefaultBaseURL: "",
			DocsURL:        "https://github.com/jaredpalmer/kev",
			Summary:        "Kev uses the same /systemone contract as Jev. Paste the host base URL that serves POST /systemone.",
			Category:       "Decisions",
			Models: []Model{
				{
					UpstreamID:          "kev-4b",
					DisplayName:         "Kev 4B",
					Description:         "One forward pass. Each question returns a calibrated probability and no generated text.",
					ContextWindow:       8192,
					InputUSDPerMillion:  0.042,
					OutputUSDPerMillion: 0,
					Kind:                KindDecision,
				},
			},
		},
	}
}
