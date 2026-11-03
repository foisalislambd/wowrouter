package wire

import (
	"encoding/json"
	"strings"
)

// PrepareEmbeddings rewrites an OpenAI embeddings body for providers that do not accept it.
// The returned function maps the upstream JSON back to the OpenAI shape. A nil function means the body is already in the upstream shape.
func PrepareEmbeddings(provider string, body map[string]any) (map[string]any, func([]byte) []byte) {
	switch strings.ToLower(provider) {
	case "gemini", "google":
		text := inputText(body["input"])
		model := asString(body["model"])
		model = strings.TrimPrefix(model, "models/")
		out := map[string]any{
			"model": "models/" + model,
			"content": map[string]any{
				"parts": []any{map[string]any{"text": text}},
			},
		}
		return out, func(raw []byte) []byte { return geminiEmbeddingToOpenAI(model, raw) }
	default:
		return body, nil
	}
}

// PrepareSpeech rewrites an OpenAI speech body for Gemini.
func PrepareSpeech(provider string, body map[string]any) map[string]any {
	if strings.ToLower(provider) != "gemini" && strings.ToLower(provider) != "google" {
		return body
	}
	return map[string]any{
		"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": asString(body["input"])}}}},
		"generationConfig": map[string]any{
			"responseModalities": []any{"AUDIO"},
			"speechConfig": map[string]any{
				"voiceConfig": map[string]any{
					"prebuiltVoiceConfig": map[string]any{"voiceName": orString(asString(body["voice"]), "Kore")},
				},
			},
		},
	}
}

// PrepareModeration rewrites an OpenAI moderation body for Gemini safety ratings.
func PrepareModeration(provider string, body map[string]any) (map[string]any, func([]byte) []byte) {
	switch strings.ToLower(provider) {
	case "gemini", "google":
		text := inputText(body["input"])
		out := map[string]any{
			"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": text}}}},
		}
		return out, geminiModerationToOpenAI
	default:
		return body, nil
	}
}

func inputText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		var parts []string
		for _, item := range t {
			if s, ok := item.(string); ok {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return asString(v)
	}
}

func orString(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func geminiEmbeddingToOpenAI(model string, raw []byte) []byte {
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return raw
	}
	emb := asMap(body["embedding"])
	values, _ := emb["values"].([]any)
	out, err := json.Marshal(map[string]any{
		"object": "list",
		"model":  model,
		"data": []any{map[string]any{
			"object": "embedding", "index": 0, "embedding": values,
		}},
	})
	if err != nil {
		return raw
	}
	return out
}

func geminiModerationToOpenAI(raw []byte) []byte {
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return raw
	}
	flagged := false
	categories := map[string]any{}
	scores := map[string]any{}
	for _, item := range asSlice(body["candidates"]) {
		cand := asMap(item)
		for _, rating := range asSlice(asMap(cand["safetyRatings"])["ratings"]) {
			row := asMap(rating)
			name := strings.ToLower(asString(row["category"]))
			blocked := strings.EqualFold(asString(row["probability"]), "HIGH") || row["blocked"] == true
			categories[name] = blocked
			if blocked {
				flagged = true
			}
			scores[name] = row["probabilityScore"]
		}
		if asMap(cand["safetyRatings"])["blocked"] == true {
			flagged = true
		}
	}
	out, err := json.Marshal(map[string]any{
		"id": "modr-wowrouter", "model": "gemini",
		"results": []any{map[string]any{"flagged": flagged, "categories": categories, "category_scores": scores}},
	})
	if err != nil {
		return raw
	}
	return out
}
