package gateway

import "testing"

func TestJSONSchemaValidatesObject(t *testing.T) {
	spec := map[string]any{"json_schema": map[string]any{"schema": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"ok": map[string]any{"type": "boolean"},
		},
		"required":             []any{"ok"},
		"additionalProperties": false,
	}}}
	if err := checkJSONSchema(spec, `{"ok":true}`, nil); err != nil {
		t.Fatal(err)
	}
	if err := checkJSONSchema(spec, `{"ok":true,"extra":1}`, nil); err == nil {
		t.Fatal("extra property was accepted")
	}
	if err := checkJSONSchema(spec, `not json`, nil); err == nil {
		t.Fatal("non-json was accepted")
	}
	req := map[string]any{"response_format": map[string]any{
		"type": "json_schema",
		"json_schema": map[string]any{"schema": map[string]any{
			"type": "object", "required": []any{"name"}, "properties": map[string]any{"name": map[string]any{"type": "string"}},
		}},
	}}
	use := map[string]any{"json_schema": map[string]any{"use_request_schema": true}}
	if err := checkJSONSchema(use, `{"name":"ada"}`, req); err != nil {
		t.Fatal(err)
	}
	if err := checkJSONSchema(use, `{}`, req); err == nil {
		t.Fatal("missing required field was accepted")
	}
}

func TestGuardrailSchemaBlocks(t *testing.T) {
	rules := []Named{{Name: "shape", Spec: map[string]any{
		"type": "json_schema", "action": "block", "enabled": true,
		"json_schema": map[string]any{"schema": map[string]any{"type": "object", "required": []any{"answer"}}},
	}}}
	bad := ApplyCall(rules, "hello", "output", nil)
	if !bad.Blocked || len(bad.Hits) != 1 || bad.Hits[0].Category != "schema_violation" {
		t.Fatalf("bad %#v", bad)
	}
	good := ApplyCall(rules, `{"answer":1}`, "output", nil)
	if good.Blocked || len(good.Hits) != 0 {
		t.Fatalf("good %#v", good)
	}
}
