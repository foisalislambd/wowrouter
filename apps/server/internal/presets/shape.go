package presets

// classify records the real chat shape for presets the catalog marked custom.
// A preset WowRouter cannot call is left unsupported instead of being sent to
// an OpenAI chat URL.
func classify(p Preset) Preset {
	p.Supported = true
	switch p.ID {
	case "9router", "cliproxyapi", "fenayai", "laozhang", "thebai", "360ai":
		// 360 AI Brain publishes OpenAI chat at /v1/chat/completions.
		p.Format = "openai"
	case "empower":
		p.Format = "openai"
		p.BaseURL = "https://app.empower.dev/api/v1"
		p.Reason = "OpenAI-compatible chat. The catalog host was corrected to app.empower.dev."
	case "claude-code", "minimax-cn-token-plan", "minimax-token-plan", "thinking-machines":
		p.Format = "claude"
		if p.Auth == "" || p.Auth == "query" {
			p.Auth = "bearer"
		}
	case "oci":
		p.Format = "openai"
		p.BaseURL = "https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1"
		p.Reason = "OCI Generative AI OpenAI-compatible chat. This base is us-chicago-1; change it for another region."
	case "watsonx":
		p.Format = "openai"
		p.BaseURL = "https://us-south.ml.cloud.ibm.com/ml/gateway/v1"
		p.Reason = "watsonx model gateway chat. This base is us-south; change it for another region."
	default:
		if reason, ok := unsupportedReason[p.ID]; ok {
			p.Supported = false
			p.Reason = reason
		} else if p.Format == "custom" {
			p.Supported = false
			p.Reason = "This preset has no OpenAI, Anthropic, or Gemini chat adapter."
		}
	}
	if stringsContainsPlaceholder(p.BaseURL) {
		p.Supported = false
		if p.Reason == "" {
			p.Reason = "The catalog base URL still has placeholders."
		}
	}
	switch p.ID {
	case "vertex", "vertex-ai", "vertex-partner":
		p.Needs = []string{"project_id", "region"}
		if p.Reason == "" {
			p.Reason = "Install asks for a Google Cloud project and region, then a Bearer access token or a service account JSON."
		}
	}
	return p
}

func stringsContainsPlaceholder(s string) bool {
	return len(s) > 0 && (containsByte(s, '<') || containsByte(s, '>'))
}

func containsByte(s string, c byte) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return true
		}
	}
	return false
}

// unsupportedReason covers every catalog preset whose API is not chat.
// Reasons name the real shape so the panel can say why install is disabled.
var unsupportedReason = map[string]string{
	"adobe-firefly":     "Image API that needs an Adobe browser session, not chat completions.",
	"amazon-q":          "Amazon Q uses an AWS Builder ID OAuth flow, not an HTTP chat base.",
	"anysearch-search":  "Search API, not chat completions.",
	"assemblyai":        "Speech-to-text API, not chat completions.",
	"aws-polly":         "Amazon Polly speech API, not chat completions.",
	"black-forest-labs": "Image generation API, not chat completions.",
	"brave-search":      "Search API, not chat completions.",
	"bria":              "Image generation API, not chat completions.",
	"cartesia":          "Speech API, not chat completions.",
	"clarifai":          "No HTTP chat base in the catalog.",
	"codex-cloud":       "Cloud agent task API, not chat completions.",
	"comfyui":           "Local image workflow API, not chat completions.",
	"context7":          "Documentation search API, not chat completions.",
	"dasha-compute":     "Described as OpenAI-compatible, but the catalog has no HTTP base yet.",
	"datarobot":         "The account API root is not a chat URL. Use a deployment URL or the LLM Gateway path.",
	"deepai":            "Per-endpoint image API, not chat completions.",
	"deepgram":          "Speech API, not chat completions.",
	"devin":             "Cloud agent task API, not chat completions.",
	"eden-ai":           "Multi-provider marketplace API, not an OpenAI chat endpoint.",
	"elevenlabs":        "Speech API, not chat completions.",
	"exa-search":        "Search API, not chat completions.",
	"fal-ai":            "Image and video API, not chat completions.",
	"firecrawl":         "Web fetch and search API, not chat completions.",
	"fishaudio":         "Speech API, not chat completions.",
	"getgoapi":          "Model marketplace API, not a documented chat endpoint.",
	"gladia":            "Speech-to-text API, not chat completions.",
	"google-pse-search": "Programmable Search API, not chat completions.",
	"hume":              "Speech API, not chat completions.",
	"inceptron":         "No HTTP chat base in the catalog.",
	"inflection":        "No HTTP chat base in the catalog.",
	"inworld":           "Speech API, not chat completions.",
	"jev-agent":         "Decision API (POST /systemone), not chat completions.",
	"jev-api-pro":       "Decision API (POST /decisions), not chat completions.",
	"jina-ai":           "Embeddings and rerank API, not chat completions.",
	"jina-reader":       "URL-to-markdown fetch API, not chat completions.",
	"jules":             "Cloud agent task API, not chat completions.",
	"kong-ai-gateway":   "No HTTP chat base in the catalog.",
	"linkup-search":     "Search API, not chat completions.",
	"luma":              "Video generation API, not chat completions.",
	"mixedbread":        "Embeddings API, not chat completions.",
	"nimble-search":     "Search API, not chat completions.",
	"nomic":             "Embeddings API, not chat completions.",
	"ollama-search":     "Search API, not chat completions.",
	"openinference":     "Tracing API, not chat completions.",
	"perceptron":        "No HTTP chat base in the catalog.",
	"perplexity-search": "Search API, not chat completions.",
	"phala":             "Catalog base is not an HTTP URL.",
	"piapi":             "Model marketplace API, not a documented chat endpoint.",
	"pinecone":          "Embeddings API, not chat completions.",
	"playht":            "Speech API, not chat completions.",
	"poe-web":           "Needs a Poe browser cookie, not an HTTP chat base.",
	"puter":             "Browser SDK chat endpoint, not an OpenAI chat API.",
	"recraft":           "Image generation API, not chat completions.",
	"replicate":         "Prediction task API for image, audio, and video, not chat completions.",
	"resemble":          "Voice cloning API, not chat completions.",
	"rev-ai":            "Speech-to-text API, not chat completions.",
	"rime":              "Text-to-speech API, not chat completions.",
	"runware":           "Image task API, not chat completions.",
	"runwayml":          "Video task API, not chat completions.",
	"sap-ai-core":       "SAP AI Core base URL still contains region and landscape placeholders.",
	"sdwebui":           "Local image API, not chat completions.",
	"searchapi-search":  "Search API, not chat completions.",
	"searxng-search":    "Search API, not chat completions.",
	"segmind":           "Image and video model API, not chat completions.",
	"serper-search":     "Search API, not chat completions.",
	"soniox":            "Speech API, not chat completions.",
	"speechmatics":      "Speech-to-text API, not chat completions.",
	"stability-ai":      "Image generation API, not chat completions.",
	"tavily-search":     "Search API, not chat completions.",
	"tinyfish":          "Web fetch API, not chat completions.",
	"topaz":             "Image API, not chat completions.",
	"v0-vercel-web":     "Needs a v0 browser cookie, not an HTTP chat base.",
	"venice-web":        "Needs a Venice browser cookie, not an HTTP chat base.",
	"voyage":            "Embeddings API, not chat completions.",
	"x-search":          "Grok X Search API, not chat completions.",
	"xquik-search":      "Search API, not chat completions.",
	"youcom-search":     "Search API, not chat completions.",
	"zed":               "Imports keys from the Zed keychain, not an HTTP chat base.",
}
