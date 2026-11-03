package presets

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCustomPresetsAreAdaptedOrFlagged(t *testing.T) {
	openai := []string{"9router", "cliproxyapi", "empower", "fenayai", "laozhang", "thebai", "360ai", "oci", "watsonx"}
	for _, id := range openai {
		p, ok := ByID(id)
		if !ok || !p.Supported || p.Format != "openai" || !p.HTTP() {
			t.Fatalf("%s %+v %v", id, p, ok)
		}
	}
	if empower, _ := ByID("empower"); empower.BaseURL != "https://app.empower.dev/api/v1" {
		t.Fatal(empower.BaseURL)
	}
	for _, id := range []string{"claude-code", "minimax-cn-token-plan", "minimax-token-plan", "thinking-machines"} {
		p, ok := ByID(id)
		if !ok || !p.Supported || p.Format != "claude" {
			t.Fatalf("%s %+v", id, p)
		}
	}
	for _, id := range []string{"elevenlabs", "replicate", "jina-ai", "tavily-search", "datarobot", "sap-ai-core", "phala", "dasha-compute"} {
		p, ok := ByID(id)
		if !ok || p.Supported || p.Reason == "" {
			t.Fatalf("%s %+v", id, p)
		}
	}
	var rows []Preset
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Format != "custom" {
			continue
		}
		p, ok := ByID(row.ID)
		if !ok {
			t.Fatal(row.ID)
		}
		if p.Supported && p.Format != "openai" && p.Format != "claude" {
			t.Fatalf("still custom: %+v", p)
		}
		if strings.Contains(p.Reason, "no OpenAI, Anthropic") {
			t.Fatalf("unclassified %s", p.ID)
		}
	}
	for _, p := range All() {
		if p.Format == "custom" && p.Supported {
			t.Fatalf("custom still callable: %s", p.ID)
		}
		if !p.Supported && p.Reason == "" {
			t.Fatalf("unsupported without a reason: %s", p.ID)
		}
	}
}

func TestAliasesShareABase(t *testing.T) {
	kimi, ok := ByID("kimi")
	if !ok || !contains(kimi.Aliases, "moonshot") {
		t.Fatalf("%+v", kimi)
	}
	moon, _ := ByID("moonshot")
	if !contains(moon.Aliases, "kimi") {
		t.Fatal(moon.Aliases)
	}
	if !kimi.Supported || !moon.Supported {
		t.Fatal("aliases must stay installable")
	}
	ant, _ := ByID("anthropic")
	if !contains(ant.Aliases, "claude") {
		t.Fatal(ant.Aliases)
	}
}

func TestVertexEndpoint(t *testing.T) {
	base, format, ptype, note, err := VertexEndpoint("vertex", "My-Project", "europe-west4")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west4/publishers/google"
	if base != want || format != "gemini" || ptype != "gemini" || note == "" {
		t.Fatalf("%s %s %s", base, format, ptype)
	}
	base, format, ptype, _, err = VertexEndpoint("vertex-partner", "my-project", "")
	if err != nil || format != "openai" || ptype != "openai_compatible" {
		t.Fatal(base, err)
	}
	if !strings.Contains(base, "/v1beta1/projects/my-project/locations/us-central1/endpoints/openapi") {
		t.Fatal(base)
	}
	if _, _, _, _, err := VertexEndpoint("vertex", "", "us-central1"); err == nil {
		t.Fatal("missing project")
	}
	if _, _, _, _, err := VertexEndpoint("vertex", "bad/id", "us-central1"); err == nil {
		t.Fatal("bad project")
	}
	v, _ := ByID("vertex")
	if !contains(v.Needs, "project_id") || !contains(v.Needs, "region") || len(v.Aliases) != 0 {
		t.Fatalf("needs %v aliases %v", v.Needs, v.Aliases)
	}
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}
