package gateway

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
)

type GuardHit struct {
	Name     string
	Action   string
	Category string
	Detail   string
}

type GuardOutcome struct {
	Blocked bool
	Flagged bool
	Text    string
	Hits    []GuardHit
}

var piiPatterns = map[string]*regexp.Regexp{
	"email":       regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`),
	"phone":       regexp.MustCompile(`\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b`),
	"us_ssn":      regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`),
	"credit_card": regexp.MustCompile(`\b(?:\d[ -]*?){13,19}\b`),
	"iban":        regexp.MustCompile(`\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b`),
	"ip_address":  regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`),
	"ca_sin":      regexp.MustCompile(`\b\d{3}-\d{3}-\d{3}\b`),
}

var secretPatterns = map[string]*regexp.Regexp{
	"openai_key":      regexp.MustCompile(`\bsk-[A-Za-z0-9]{16,}\b`),
	"anthropic_key":   regexp.MustCompile(`\bsk-ant-[A-Za-z0-9\-_]{16,}\b`),
	"aws_access_key":  regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
	"github_token":    regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{20,}\b`),
	"slack_token":     regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9-]{10,}\b`),
	"google_api_key":  regexp.MustCompile(`\bAIza[0-9A-Za-z\-_]{20,}\b`),
	"stripe_key":      regexp.MustCompile(`\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b`),
	"jwt":             regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`),
	"pem_private_key": regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`),
}

// Apply runs enabled guardrails over text. Order follows each spec's order field.
func Apply(rules []Named, text, stage string) GuardOutcome {
	return ApplyCall(rules, text, stage, nil)
}

// ApplyCall is Apply with the original request, so a JSON Schema guard can use the request schema.
func ApplyCall(rules []Named, text, stage string, req map[string]any) GuardOutcome {
	out := GuardOutcome{Text: text}
	sorted := append([]Named(nil), rules...)
	for i := 1; i < len(sorted); i++ {
		j := i
		for j > 0 && asFloat(sorted[j].Spec["order"]) < asFloat(sorted[j-1].Spec["order"]) {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
			j--
		}
	}
	for _, rule := range sorted {
		spec := rule.Spec
		if spec["enabled"] == false {
			continue
		}
		if !stageWanted(spec, stage) {
			continue
		}
		action := asString(spec["action"])
		if action == "" {
			action = "flag"
		}
		kind := asString(spec["type"])
		var hits []GuardHit
		var next string
		switch kind {
		case "keywords":
			next, hits = keywords(rule.Name, action, out.Text, asMap(spec["keywords"]))
		case "regex":
			next, hits = regexes(rule.Name, action, out.Text, asMap(spec["regex"]))
		case "pii":
			next, hits = patterns(rule.Name, action, out.Text, piiWanted(asMap(spec["pii"])), "pii")
		case "secrets":
			next, hits = patterns(rule.Name, action, out.Text, secretWanted(asMap(spec["secrets"])), "secret")
		case "json_schema":
			if stage == "output" {
				if err := checkJSONSchema(spec, out.Text, req); err != nil {
					hits = []GuardHit{{Name: rule.Name, Action: action, Category: "schema_violation", Detail: err.Error()}}
				}
			}
		case "tool_permission":
			hits = toolDenied(rule.Name, action, out.Text, asMap(spec["tool_permission"]))
		case "length":
			max := int(asFloat(asMap(spec["length"])["max_chars"]))
			if max > 0 && len(out.Text) > max {
				hits = []GuardHit{{Name: rule.Name, Action: action, Category: "length", Detail: "over the length limit"}}
				if action == "redact" {
					next = out.Text[:max]
				}
			}
		case "topic":
			next, hits = keywords(rule.Name, action, out.Text, map[string]any{"words": asMap(spec["topic"])["deny"], "match": "substring"})
			for i := range hits {
				hits[i].Category = "off_topic"
			}
		default:
			continue
		}
		if next != "" {
			out.Text = next
		}
		for _, hit := range hits {
			out.Hits = append(out.Hits, hit)
			switch action {
			case "block":
				out.Blocked = true
			case "flag", "divert":
				out.Flagged = true
			}
		}
		if out.Blocked {
			return out
		}
	}
	return out
}

func stageWanted(spec map[string]any, stage string) bool {
	raw := asSlice(spec["request_stages"])
	if len(raw) == 0 {
		return true
	}
	for _, item := range raw {
		if asString(item) == stage || (stage == "input" && asString(item) == "request") || (stage == "output" && asString(item) == "response") {
			return true
		}
	}
	return false
}

func keywords(name, action, text string, spec map[string]any) (string, []GuardHit) {
	match := asString(spec["match"])
	var hits []GuardHit
	next := text
	for _, w := range asSlice(spec["words"]) {
		word := asString(w)
		if word == "" {
			continue
		}
		found := false
		if match == "word" {
			found = regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(word) + `\b`).MatchString(text)
		} else {
			found = strings.Contains(strings.ToLower(text), strings.ToLower(word))
		}
		if !found {
			continue
		}
		hits = append(hits, GuardHit{Name: name, Action: action, Category: "keyword", Detail: word})
		if action == "redact" {
			re := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(word))
			next = re.ReplaceAllString(next, "[keyword]")
		}
	}
	return next, hits
}

func regexes(name, action, text string, spec map[string]any) (string, []GuardHit) {
	var hits []GuardHit
	next := text
	for _, p := range asSlice(spec["deny"]) {
		re, err := regexp.Compile(asString(p))
		if err != nil || !re.MatchString(text) {
			continue
		}
		hits = append(hits, GuardHit{Name: name, Action: action, Category: "deny_pattern", Detail: asString(p)})
		if action == "redact" {
			next = re.ReplaceAllString(next, "[redacted]")
		}
	}
	return next, hits
}

func patterns(name, action, text string, regs map[string]*regexp.Regexp, category string) (string, []GuardHit) {
	var hits []GuardHit
	next := text
	for label, re := range regs {
		if re == nil || !re.MatchString(text) {
			continue
		}
		hits = append(hits, GuardHit{Name: name, Action: action, Category: category, Detail: label})
		if action == "redact" {
			next = re.ReplaceAllStringFunc(next, func(s string) string {
				if label == "credit_card" && len(s) >= 4 {
					return "[card:" + s[len(s)-4:] + "]"
				}
				return "[" + label + "]"
			})
		}
	}
	return next, hits
}

func piiWanted(spec map[string]any) map[string]*regexp.Regexp {
	raw := asSlice(spec["entities"])
	if len(raw) == 0 {
		return piiPatterns
	}
	out := map[string]*regexp.Regexp{}
	for _, item := range raw {
		name := asString(item)
		if re := piiPatterns[name]; re != nil {
			out[name] = re
		}
	}
	return out
}

func secretWanted(spec map[string]any) map[string]*regexp.Regexp {
	raw := asSlice(spec["detectors"])
	if len(raw) == 0 {
		return secretPatterns
	}
	out := map[string]*regexp.Regexp{}
	for _, item := range raw {
		name := asString(item)
		if re := secretPatterns[name]; re != nil {
			out[name] = re
		}
	}
	return out
}

func jsonOK(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return true
	}
	var v any
	return json.Unmarshal([]byte(text), &v) == nil
}

func toolDenied(name, action, text string, spec map[string]any) []GuardHit {
	allow := map[string]bool{}
	for _, item := range asSlice(spec["allow"]) {
		allow[asString(item)] = true
	}
	if len(allow) == 0 {
		return nil
	}
	var hits []GuardHit
	re := regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`)
	for _, m := range re.FindAllStringSubmatch(text, -1) {
		if !allow[m[1]] {
			hits = append(hits, GuardHit{Name: name, Action: action, Category: "tool_not_allowed", Detail: m[1]})
		}
	}
	return hits
}

func MessageText(body map[string]any) string {
	var b strings.Builder
	for _, msg := range asSlice(body["messages"]) {
		m := asMap(msg)
		switch c := m["content"].(type) {
		case string:
			b.WriteString(c)
			b.WriteByte('\n')
		}
	}
	if b.Len() == 0 {
		b.WriteString(asString(body["prompt"]))
	}
	return b.String()
}

func RewriteMessages(body map[string]any, text string) {
	msgs := asSlice(body["messages"])
	if len(msgs) == 0 {
		return
	}
	// Put the redacted text on the last user message and leave other turns intact when we only have a flat string.
	for i := len(msgs) - 1; i >= 0; i-- {
		m := asMap(msgs[i])
		if asString(m["role"]) == "user" || i == len(msgs)-1 {
			if _, ok := m["content"].(string); ok {
				m["content"] = text
				msgs[i] = m
				body["messages"] = msgs
				return
			}
		}
	}
}

func ResponseText(payload []byte) string {
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil {
		return ""
	}
	choices := asSlice(body["choices"])
	if len(choices) == 0 {
		return asString(body["output_text"])
	}
	msg := asMap(asMap(choices[0])["message"])
	return asString(msg["content"])
}

func RewriteResponse(payload []byte, text string) []byte {
	var body map[string]any
	if json.Unmarshal(payload, &body) != nil {
		return payload
	}
	choices := asSlice(body["choices"])
	if len(choices) == 0 {
		return payload
	}
	choice := asMap(choices[0])
	msg := asMap(choice["message"])
	msg["content"] = text
	choice["message"] = msg
	choices[0] = choice
	body["choices"] = choices
	raw, err := json.Marshal(body)
	if err != nil {
		return payload
	}
	return raw
}

func ExactKey(model string, body map[string]any) string {
	raw, _ := json.Marshal(body["messages"])
	sum := sha256.Sum256(append([]byte(model+"\n"), raw...))
	return hex.EncodeToString(sum[:])
}
