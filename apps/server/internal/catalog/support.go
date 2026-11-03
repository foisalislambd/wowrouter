package catalog

// supportNote is a protocol upgrade for a provider the generated catalog left unsupported.
// The generated file stays untouched. A later regen keeps these overrides.
type supportNote struct {
	Protocol    string
	BaseURL     string
	StaleBase   string
	Summary     string
	KeyOptional bool
	Models      []Model
}

func applySupport(providers []Provider) []Provider {
	notes := supportNotes()
	for i := range providers {
		note, ok := notes[providers[i].Slug]
		if !ok {
			continue
		}
		providers[i].Protocol = note.Protocol
		if note.BaseURL != "" {
			providers[i].DefaultBaseURL = note.BaseURL
		}
		if note.Summary != "" {
			providers[i].Summary = note.Summary
		}
		if note.KeyOptional {
			providers[i].KeyOptional = true
		}
		if len(note.Models) > 0 && len(providers[i].Models) == 0 {
			providers[i].Models = note.Models
		}
	}
	return providers
}

// MigrateBase returns the base URL that should replace a known stale default.
func MigrateBase(slug, current string) (string, bool) {
	note, ok := supportNotes()[slug]
	if !ok || note.BaseURL == "" || note.StaleBase == "" {
		return "", false
	}
	if current == note.StaleBase {
		return note.BaseURL, true
	}
	return "", false
}

func supportNotes() map[string]supportNote {
	chat := func(id, name string) Model {
		return Model{UpstreamID: id, DisplayName: name, Kind: KindChat, ContextWindow: 128000, MaxOutputTokens: 8192}
	}
	return map[string]supportNote{
		"inflection": {
			Protocol: ProtocolOpenAIChat,
			BaseURL:  "https://api.inflection.ai/external/api/inference/openai/v1",
			Summary:  "Official Inflection chat. Paste an API key. Requests use the OpenAI-compatible endpoint, including tools and streaming.",
		},
		"clarifai": {
			Protocol: ProtocolOpenAIChat,
			BaseURL:  "https://api.clarifai.com/v2/ext/openai/v1",
			Summary:  "Official Clarifai OpenAI-compatible endpoint. Paste a personal access token.",
		},
		"eden-ai": {
			Protocol: ProtocolOpenAIChat,
			BaseURL:  "https://api.edenai.run/v3",
			Summary:  "Official Eden AI chat completions. Paste an API key. Model ids look like openai/gpt-latest.",
		},
		"piapi": {
			Protocol: ProtocolOpenAIChat,
			BaseURL:  "https://api.piapi.ai/v1",
			Summary:  "PiAPI's OpenAI-compatible chat endpoint. Paste an API key.",
		},
		"kong-ai-gateway": {
			Protocol: ProtocolOpenAIChat,
			Summary:  "Paste the OpenAI-compatible base URL of your Kong AI Gateway. The gateway key is the API key.",
		},
		"inceptron": {
			Protocol: ProtocolOpenAIChat,
			Summary:  "Paste the OpenAI-compatible base URL of your Inceptron deployment, then save its API key.",
		},
		"clova-studio": {
			Protocol:  ProtocolClova,
			BaseURL:   "https://clovastudio.stream.ntruss.com/v3",
			StaleBase: "https://clovastudio.stream.ntruss.com/v3",
			Summary:   "Official CLOVA Studio v3 chat. Paste an API key. HCX-007, HCX-005, and HCX-DASH-002 stream upstream and are returned as one reply when the client did not ask to stream.",
		},
		"codex-cloud": {
			Protocol:  ProtocolOpenAIChat,
			BaseURL:   "https://api.openai.com/v1",
			StaleBase: "https://chatgpt.com/backend-api/codex",
			Summary:   "Uses an OpenAI API key against the official chat endpoint. Set the model id to the Codex model your key can call.",
			Models:    []Model{chat("gpt-5.3-codex", "Codex")},
		},
		"gitlab-duo": {
			Protocol:  ProtocolGitLab,
			BaseURL:   "https://gitlab.com/api/v4",
			StaleBase: "https://gitlab.com/api/v4/ai",
			Summary:   "GitLab Duo code suggestions. Paste a personal access token. For a self-managed instance, set the base URL to https://gitlab.example.com/api/v4.",
		},
		"bedrock": {
			Protocol:  ProtocolBedrock,
			BaseURL:   "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
			StaleBase: "https://bedrock-runtime.<region>.amazonaws.com",
			Summary:   "Amazon Bedrock's OpenAI-compatible runtime, signed with AWS SigV4. Save the key as accessKeyId:secretAccessKey. Add :sessionToken when you use temporary credentials. Change the region in the base URL if you need another region.",
		},
		"sap-ai-core": {
			Protocol: ProtocolSAP,
			Summary:  "Paste the SAP AI Core service key JSON as the API key, and set the base URL to your deployment's chat URL.",
		},
		"jules": {
			Protocol:  ProtocolCloudAgent,
			BaseURL:   "https://jules.googleapis.com",
			StaleBase: "https://jules.google",
			Summary:   "Official Jules API. Paste an API key from jules.google.com/settings. A chat call creates a coding session and returns its URL.",
			Models:    []Model{chat("session", "Jules session")},
		},
		"devin": {
			Protocol: ProtocolCloudAgent,
			BaseURL:  "https://api.devin.ai",
			Summary:  "Devin sessions. Paste an API key. A chat call opens a cloud session and returns its id and URL.",
			Models:   []Model{chat("session", "Devin session")},
		},
		"comfyui": {
			Protocol:    ProtocolComfy,
			BaseURL:     "http://127.0.0.1:8188",
			StaleBase:   "http://localhost:8188",
			KeyOptional: true,
			Summary:     "Local ComfyUI. No key. Paste a workflow JSON as the message to queue that graph, or send plain text and WowRouter queues a one-node workflow. The reply is the history entry for that prompt.",
			Models:      []Model{{UpstreamID: "prompt", DisplayName: "Prompt", Kind: KindImage, Description: "Queues a ComfyUI prompt"}},
		},
		"duckduckgo-web": {
			Protocol: ProtocolDuck,
			Summary:  "Unofficial. Anonymous Duck.ai chat with no key. DuckDuckGo can change or block this without notice.",
		},
		"ghe-copilot": {
			Protocol:    ProtocolOAuthDevice,
			KeyOptional: true,
			Summary:     "Sign in with GitHub's device flow. Enter your enterprise URL as the base URL and the OAuth app's client id, then choose Sign in. The access token is encrypted on this computer. Chat calls send it as a bearer token.",
		},
		"copilot-web": {
			Protocol: ProtocolSession,
			BaseURL:  "https://copilot.microsoft.com/c/api",
			Summary:  "Unofficial and experimental. Paste only the access token from a signed-in copilot.microsoft.com request. Do not paste the whole Cookie header. Microsoft can change this without notice.",
		},
	}
}
