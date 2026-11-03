package catalog

// extraProviders adds well-known OpenAI-compatible endpoints that the generated
// list does not already name. Slugs already present in All() are skipped.
func extraProviders() []Provider {
	return []Provider{
		openaiCompat("gemini", "Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "https://ai.google.dev/gemini-api/docs/openai", "Google's OpenAI-compatible Gemini endpoint.", "Frontier",
			chat("gemini-2.5-pro", "Gemini 2.5 Pro", 1.25, 10, true),
			chat("gemini-2.5-flash", "Gemini 2.5 Flash", 0.15, 0.6, false)),
		openaiCompat("qwen", "Qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://www.alibabacloud.com/help/en/model-studio/use-qwen-by-calling-api", "Alibaba Cloud Qwen via the international compatible-mode URL. A China-region key uses the DashScope provider instead.", "Frontier",
			chat("qwen-max", "Qwen Max", 1.6, 6.4, true),
			chat("qwen-plus", "Qwen Plus", 0.4, 1.2, false)),
		openaiCompat("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "https://docs.api.nvidia.com/", "NVIDIA's OpenAI-compatible inference API.", "Inference",
			chat("meta/llama-3.1-70b-instruct", "Llama 3.1 70B Instruct", 0, 0, false)),
		openaiCompat("cloudflare", "Cloudflare Workers AI", "", "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/", "Paste the account URL from the Cloudflare dashboard. It looks like https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1.", "Inference"),
		openaiCompat("baidu-qianfan", "Baidu Qianfan", "https://qianfan.baidubce.com/v2", "https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j", "Baidu Qianfan OpenAI-compatible chat.", "Frontier",
			chat("ernie-4.5-turbo-128k", "ERNIE 4.5 Turbo", 0.8, 3.2, false)),
		openaiCompat("zai", "Z.ai", "https://api.z.ai/api/paas/v4", "https://docs.z.ai/", "Z.ai GLM models on an OpenAI-compatible base URL.", "Frontier",
			chat("glm-4.5", "GLM-4.5", 0.6, 2.2, true)),
		localCompat("lmstudio", "LM Studio", "http://127.0.0.1:1234/v1", "https://lmstudio.ai/docs/app/api", "A local LM Studio server. No key is required."),
		localCompat("llama-cpp", "llama.cpp", "http://127.0.0.1:8080/v1", "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md", "llama.cpp's local server. No key is required."),
		openaiCompat("featherless", "Featherless", "https://api.featherless.ai/v1", "https://featherless.ai/docs", "Featherless OpenAI-compatible hosting.", "Inference",
			chat("meta-llama/Meta-Llama-3.1-8B-Instruct", "Llama 3.1 8B", 0.02, 0.02, false)),
		openaiCompat("lambda", "Lambda", "https://api.lambdalabs.com/v1", "https://docs.lambdalabs.com/public-cloud/lambda-chat-api/", "Lambda inference API.", "Inference",
			chat("llama3.1-70b-instruct-fp8", "Llama 3.1 70B", 0.9, 0.9, false)),
		openaiCompat("ovh", "OVHcloud AI Endpoints", "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", "https://help.ovhcloud.com/csm/en-public-cloud-ai-endpoints-getting-started", "OVHcloud AI Endpoints.", "Inference"),
		openaiCompat("jina", "Jina", "https://api.jina.ai/v1", "https://jina.ai/embeddings/", "Jina embeddings. Call them with the embeddings endpoint.", "Search",
			embed("jina-embeddings-v3", "Jina Embeddings v3")),
		openaiCompat("hunyuan", "Hunyuan", "https://api.hunyuan.cloud.tencent.com/v1", "https://cloud.tencent.com/document/product/1729", "Tencent Hunyuan OpenAI-compatible API.", "Frontier",
			chat("hunyuan-turbos-latest", "Hunyuan TurboS", 0.8, 2, false)),
		openaiCompat("volcengine-ark", "Volcengine Ark", "https://ark.cn-beijing.volces.com/api/v3", "https://www.volcengine.com/docs/82379", "ByteDance Ark. The model id is often an endpoint id from the console.", "Frontier"),
		openaiCompat("01-ai", "01.AI", "https://api.lingyiwanwu.com/v1", "https://platform.lingyiwanwu.com/docs", "01.AI Yi models.", "Frontier",
			chat("yi-lightning", "Yi Lightning", 0.14, 0.14, false)),
		openaiCompat("kimi", "Kimi", "https://api.moonshot.ai/v1", "https://platform.moonshot.ai/docs", "Moonshot Kimi on the international API. The same models also exist under Moonshot.", "Frontier",
			chat("kimi-latest", "Kimi Latest", 2, 5, true)),
		openaiCompat("naga", "NagaAI", "https://api.naga.ac/v1", "https://naga.ac/", "NagaAI OpenAI-compatible gateway.", "Gateway"),
		openaiCompat("targon", "Targon", "https://api.targon.com/v1", "https://docs.targon.com/", "Targon OpenAI-compatible inference.", "Inference"),
		openaiCompat("ionet", "io.net", "https://api.intelligence.io.solutions/api/v1", "https://docs.io.net/reference/api", "io.net intelligence API.", "Inference"),
		openaiCompat("akash", "AkashML", "https://chatapi.akash.network/api/v1", "https://docs.akash.network/", "Akash chat API.", "Inference"),
		localCompat("gaianet", "GaiaNet", "http://127.0.0.1:9068/v1", "https://docs.gaianet.ai/", "A local GaiaNet node. No key is required."),
		localCompat("text-generation-webui", "text-generation-webui", "http://127.0.0.1:5000/v1", "https://github.com/oobabooga/text-generation-webui", "oobabooga's local OpenAI extension. No key is required."),
		localCompat("koboldcpp", "koboldcpp", "http://127.0.0.1:5001/v1", "https://github.com/LostRuins/koboldcpp", "koboldcpp's local server. No key is required."),
	}
}

func openaiCompat(slug, name, base, docs, summary, category string, models ...Model) Provider {
	return Provider{
		Slug: slug, DisplayName: name, Protocol: ProtocolOpenAIChat,
		DefaultBaseURL: base, DocsURL: docs, Summary: summary, Category: category, Models: models,
	}
}

func localCompat(slug, name, base, docs, summary string) Provider {
	return Provider{
		Slug: slug, DisplayName: name, Protocol: ProtocolOpenAIChat,
		DefaultBaseURL: base, DocsURL: docs, Summary: summary, Category: "Local",
		KeyOptional: true,
		Models:      []Model{chat("local", name+" model", 0, 0, false)},
	}
}

func chat(id, name string, in, out float64, reasoning bool) Model {
	return Model{
		UpstreamID: id, DisplayName: name, Kind: KindChat,
		ContextWindow: 128000, MaxOutputTokens: 8192,
		InputUSDPerMillion: in, OutputUSDPerMillion: out, Reasoning: reasoning,
	}
}

func embed(id, name string) Model {
	return Model{
		UpstreamID: id, DisplayName: name, Kind: KindEmbedding,
		ContextWindow: 8192, InputUSDPerMillion: 0.02,
	}
}
