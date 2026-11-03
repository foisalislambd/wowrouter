package panelapi

// knownProviders is a short handwritten directory so the panel can offer
// common upstreams before any key is saved. It is not a generated catalog.
var knownProviders = []directoryEntry{
	{Slug: "openai", Display: "OpenAI", Protocol: "openai", BaseURL: "https://api.openai.com/v1", Docs: "https://platform.openai.com/docs", Summary: "Chat, images, and embeddings from OpenAI.", Category: "Cloud", Free: false},
	{Slug: "anthropic", Display: "Anthropic", Protocol: "anthropic", BaseURL: "https://api.anthropic.com", Docs: "https://docs.anthropic.com", Summary: "Claude models over the Messages API.", Category: "Cloud", Free: false},
	{Slug: "gemini", Display: "Google Gemini", Protocol: "gemini", BaseURL: "https://generativelanguage.googleapis.com/v1beta", Docs: "https://ai.google.dev", Summary: "Gemini models on Google's API.", Category: "Cloud", Free: false},
	{Slug: "azure", Display: "Azure OpenAI", Protocol: "azure_openai", BaseURL: "", Docs: "https://learn.microsoft.com/azure/ai-services/openai/", Summary: "OpenAI models hosted in your Azure resource.", Category: "Cloud", Free: false},
	{Slug: "groq", Display: "Groq", Protocol: "openai", BaseURL: "https://api.groq.com/openai/v1", Docs: "https://console.groq.com/docs", Summary: "OpenAI-compatible chat on Groq.", Category: "Cloud", Free: false},
	{Slug: "mistral", Display: "Mistral", Protocol: "openai", BaseURL: "https://api.mistral.ai/v1", Docs: "https://docs.mistral.ai", Summary: "Mistral chat over an OpenAI-compatible URL.", Category: "Cloud", Free: false},
	{Slug: "deepseek", Display: "DeepSeek", Protocol: "openai", BaseURL: "https://api.deepseek.com/v1", Docs: "https://api-docs.deepseek.com", Summary: "DeepSeek chat over an OpenAI-compatible URL.", Category: "Cloud", Free: false},
	{Slug: "xai", Display: "xAI", Protocol: "openai", BaseURL: "https://api.x.ai/v1", Docs: "https://docs.x.ai", Summary: "Grok models over an OpenAI-compatible URL.", Category: "Cloud", Free: false},
	{Slug: "together", Display: "Together", Protocol: "openai", BaseURL: "https://api.together.xyz/v1", Docs: "https://docs.together.ai", Summary: "Hosted open models over an OpenAI-compatible URL.", Category: "Host", Free: false},
	{Slug: "fireworks", Display: "Fireworks", Protocol: "openai", BaseURL: "https://api.fireworks.ai/inference/v1", Docs: "https://docs.fireworks.ai", Summary: "Fireworks inference over an OpenAI-compatible URL.", Category: "Host", Free: false},
	{Slug: "cerebras", Display: "Cerebras", Protocol: "openai", BaseURL: "https://api.cerebras.ai/v1", Docs: "https://inference-docs.cerebras.ai", Summary: "Cerebras inference over an OpenAI-compatible URL.", Category: "Host", Free: false},
	{Slug: "cohere", Display: "Cohere", Protocol: "openai", BaseURL: "https://api.cohere.ai/compatibility/v1", Docs: "https://docs.cohere.com", Summary: "Cohere's OpenAI-compatible chat endpoint.", Category: "Cloud", Free: false},
	{Slug: "perplexity", Display: "Perplexity", Protocol: "openai", BaseURL: "https://api.perplexity.ai", Docs: "https://docs.perplexity.ai", Summary: "Sonar models over an OpenAI-compatible URL.", Category: "Cloud", Free: false},
	{Slug: "openrouter", Display: "OpenRouter", Protocol: "openai", BaseURL: "https://openrouter.ai/api/v1", Docs: "https://openrouter.ai/docs", Summary: "One key for many upstream models.", Category: "Router", Free: false},
	{Slug: "ollama", Display: "Ollama", Protocol: "openai", BaseURL: "http://127.0.0.1:11434/v1", Docs: "https://github.com/ollama/ollama/blob/main/docs/openai.md", Summary: "Models running on this computer through Ollama.", Category: "Local", Free: true, KeyOptional: true},
}

type directoryEntry struct {
	Slug, Display, Protocol, BaseURL, Docs, Summary, Category string
	Free, KeyOptional                                         bool
}

func directoryBySlug(slug string) (directoryEntry, bool) {
	for _, item := range knownProviders {
		if item.Slug == slug {
			return item, true
		}
	}
	return directoryEntry{}, false
}
