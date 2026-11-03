package presets

import (
	"fmt"
	"regexp"
	"strings"
)

var gcpName = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)

// VertexEndpoint is the callable Google base for a Vertex preset.
// vertex uses the Gemini publisher API. vertex-ai and vertex-partner use the
// OpenAI-compatible endpoints/openapi API, so partner model ids travel in the
// chat model field. Claude rawPredict is not a separate adapter.
func VertexEndpoint(id, project, region string) (base, format, providerType, note string, err error) {
	project = strings.ToLower(strings.TrimSpace(project))
	region = strings.ToLower(strings.TrimSpace(region))
	if region == "" {
		region = "us-central1"
	}
	if !gcpName.MatchString(project) {
		return "", "", "", "", fmt.Errorf("Vertex needs a Google Cloud project id")
	}
	if !gcpName.MatchString(region) {
		return "", "", "", "", fmt.Errorf("Vertex region must look like us-central1")
	}
	host := region + "-aiplatform.googleapis.com"
	switch id {
	case "vertex":
		base = "https://" + host + "/v1/projects/" + project + "/locations/" + region + "/publishers/google"
		format = "gemini"
		providerType = "gemini"
		note = "Vertex Gemini publisher endpoint. Calls use a Bearer access token. Paste one, or install a service account JSON and WowRouter will exchange it. Claude rawPredict is not used here."
	case "vertex-ai", "vertex-partner":
		base = "https://" + host + "/v1beta1/projects/" + project + "/locations/" + region + "/endpoints/openapi"
		format = "openai"
		providerType = "openai_compatible"
		note = "Vertex OpenAI-compatible endpoint. Model ids, including partner models, are sent as the chat model. Claude-on-Vertex rawPredict is not a separate adapter. Auth is a Bearer access token or a service account JSON."
	default:
		return "", "", "", "", fmt.Errorf("not a Vertex preset")
	}
	return base, format, providerType, note, nil
}
