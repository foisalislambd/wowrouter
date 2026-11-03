package gateway

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// CompletionToSSE wraps a chat completion JSON body as an OpenAI SSE stream.
func CompletionToSSE(model string, payload []byte) []byte {
	text := ResponseText(payload)
	if text == "" {
		var raw map[string]any
		if json.Unmarshal(payload, &raw) == nil {
			text = asString(raw["output_text"])
		}
	}
	if model == "" {
		var raw map[string]any
		if json.Unmarshal(payload, &raw) == nil {
			model = asString(raw["model"])
		}
	}
	first, _ := json.Marshal(map[string]any{
		"id": "chatcmpl-wowrouter", "object": "chat.completion.chunk", "model": model,
		"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant", "content": text}, "finish_reason": nil}},
	})
	stop, _ := json.Marshal(map[string]any{
		"id": "chatcmpl-wowrouter", "object": "chat.completion.chunk", "model": model,
		"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}},
	})
	return []byte("data: " + string(first) + "\n\ndata: " + string(stop) + "\n\ndata: [DONE]\n\n")
}

func checkJSONSchema(spec map[string]any, text string, req map[string]any) error {
	js := asMap(spec["json_schema"])
	var schema any
	if js["use_request_schema"] == true {
		schema = requestJSONSchema(req)
		if schema == nil {
			return fmt.Errorf("request has no JSON schema")
		}
	} else if _, ok := js["schema"]; ok {
		schema = js["schema"]
	} else {
		return fmt.Errorf("JSON schema guard has no schema")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return fmt.Errorf("response is empty")
	}
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return fmt.Errorf("response is not JSON")
	}
	if err := validateSchema(schema, value, "$"); err != nil {
		return err
	}
	return nil
}

func requestJSONSchema(req map[string]any) any {
	if req == nil {
		return nil
	}
	format := asMap(req["response_format"])
	if asString(format["type"]) == "json_schema" {
		inner := asMap(format["json_schema"])
		if inner["schema"] != nil {
			return inner["schema"]
		}
	}
	if schema := asMap(req["text"]); schema["format"] != nil {
		format = asMap(schema["format"])
		if format["schema"] != nil {
			return format["schema"]
		}
	}
	return nil
}

func validateSchema(schema any, value any, path string) error {
	switch s := schema.(type) {
	case bool:
		if s {
			return nil
		}
		return fmt.Errorf("%s does not match the schema", path)
	case map[string]any:
		if ref := asString(s["$ref"]); strings.HasPrefix(ref, "#/") {
			// Local refs are resolved by the caller when the root is available. A bare fragment is ignored.
		}
		if enum, ok := s["enum"]; ok {
			found := false
			for _, item := range asSlice(enum) {
				if jsonEqual(item, value) {
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("%s is not one of the allowed values", path)
			}
		}
		if c, ok := s["const"]; ok && !jsonEqual(c, value) {
			return fmt.Errorf("%s does not match const", path)
		}
		if t := s["type"]; t != nil {
			if err := checkTypes(t, value, path); err != nil {
				return err
			}
		}
		if anyOf := asSlice(s["anyOf"]); len(anyOf) > 0 {
			ok := false
			for _, sub := range anyOf {
				if validateSchema(sub, value, path) == nil {
					ok = true
					break
				}
			}
			if !ok {
				return fmt.Errorf("%s matches none of anyOf", path)
			}
		}
		for _, sub := range asSlice(s["allOf"]) {
			if err := validateSchema(sub, value, path); err != nil {
				return err
			}
		}
		if oneOf := asSlice(s["oneOf"]); len(oneOf) > 0 {
			matches := 0
			for _, sub := range oneOf {
				if validateSchema(sub, value, path) == nil {
					matches++
				}
			}
			if matches != 1 {
				return fmt.Errorf("%s matches %d oneOf schemas", path, matches)
			}
		}
		switch v := value.(type) {
		case map[string]any:
			props := asMap(s["properties"])
			for name, sub := range props {
				if child, ok := v[name]; ok {
					if err := validateSchema(sub, child, path+"."+name); err != nil {
						return err
					}
				}
			}
			for _, item := range asSlice(s["required"]) {
				name := asString(item)
				if name == "" {
					continue
				}
				if _, ok := v[name]; !ok {
					return fmt.Errorf("%s.%s is required", path, name)
				}
			}
			if add, ok := s["additionalProperties"]; ok {
				switch extra := add.(type) {
				case bool:
					if !extra {
						for name := range v {
							if _, known := props[name]; !known {
								return fmt.Errorf("%s.%s is not allowed", path, name)
							}
						}
					}
				default:
					for name, child := range v {
						if _, known := props[name]; known {
							continue
						}
						if err := validateSchema(extra, child, path+"."+name); err != nil {
							return err
						}
					}
				}
			}
		case []any:
			if items, ok := s["items"]; ok {
				for i, child := range v {
					if err := validateSchema(items, child, fmt.Sprintf("%s[%d]", path, i)); err != nil {
						return err
					}
				}
			}
			if min := asFloat(s["minItems"]); s["minItems"] != nil && len(v) < int(min) {
				return fmt.Errorf("%s has too few items", path)
			}
			if max, ok := s["maxItems"]; ok && len(v) > int(asFloat(max)) {
				return fmt.Errorf("%s has too many items", path)
			}
		case string:
			if min, ok := s["minLength"]; ok && len(v) < int(asFloat(min)) {
				return fmt.Errorf("%s is too short", path)
			}
			if max, ok := s["maxLength"]; ok && len(v) > int(asFloat(max)) {
				return fmt.Errorf("%s is too long", path)
			}
			if pat := asString(s["pattern"]); pat != "" {
				re, err := regexp.Compile(pat)
				if err != nil {
					return fmt.Errorf("schema pattern is invalid")
				}
				if !re.MatchString(v) {
					return fmt.Errorf("%s does not match the pattern", path)
				}
			}
		case float64:
			if err := checkNumber(s, v, path); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("schema at %s is not an object", path)
	}
}

func checkTypes(t any, value any, path string) error {
	switch typed := t.(type) {
	case string:
		if !typeOK(typed, value) {
			return fmt.Errorf("%s is not a %s", path, typed)
		}
	case []any:
		ok := false
		for _, item := range typed {
			if typeOK(asString(item), value) {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Errorf("%s has the wrong type", path)
		}
	}
	return nil
}

func typeOK(kind string, value any) bool {
	switch kind {
	case "":
		return true
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array":
		_, ok := value.([]any)
		return ok
	case "string":
		_, ok := value.(string)
		return ok
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "null":
		return value == nil
	case "number":
		_, ok := value.(float64)
		return ok
	case "integer":
		n, ok := value.(float64)
		return ok && n == float64(int64(n))
	default:
		return true
	}
}

func checkNumber(schema map[string]any, n float64, path string) error {
	if v, ok := schema["minimum"]; ok && n < asFloat(v) {
		return fmt.Errorf("%s is below the minimum", path)
	}
	if v, ok := schema["maximum"]; ok && n > asFloat(v) {
		return fmt.Errorf("%s is above the maximum", path)
	}
	if v, ok := schema["exclusiveMinimum"]; ok && n <= asFloat(v) {
		return fmt.Errorf("%s is below the minimum", path)
	}
	if v, ok := schema["exclusiveMaximum"]; ok && n >= asFloat(v) {
		return fmt.Errorf("%s is above the maximum", path)
	}
	return nil
}

func jsonEqual(a, b any) bool {
	ab, errA := json.Marshal(a)
	bb, errB := json.Marshal(b)
	return errA == nil && errB == nil && string(ab) == string(bb)
}
