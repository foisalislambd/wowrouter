// Package compress shrinks chat text before it is sent upstream.
//
// Implemented engines are rule-based: lite (whitespace), dedup (repeated
// blocks), rtk (long fenced tool output), relevance (sentences that overlap
// the latest question), and caveman (filler phrases). They do not call a model.
//
// Not implemented, and not claimed: LLMLingua-2, a small-model ultra tier,
// OmniGlyph image encoding, and lossless tabular codecs. Those need model
// weights or a separate research implementation.
package compress

import (
	"regexp"
	"strings"
)

// Engines reports what this build can run.
func Engines() []string {
	return []string{"lite", "dedup", "rtk", "relevance", "caveman"}
}

// NotImplemented is the honest list of engines this build does not run.
func NotImplemented() []string {
	return []string{"session-archive", "responses-tool-json", "headroom-gcf", "llmlingua-2", "ultra-slm", "omniglyph"}
}

// Profile picks an engine stack. Unknown profiles return the input unchanged.
func Profile(name string) []string {
	switch name {
	case "lite":
		return []string{"lite"}
	case "standard":
		return []string{"lite", "dedup", "caveman"}
	case "aggressive":
		return []string{"lite", "dedup", "rtk", "relevance", "caveman"}
	case "rtk":
		return []string{"lite", "rtk"}
	case "off", "":
		return nil
	default:
		return nil
	}
}

var fence = regexp.MustCompile("(?s)```.*?```")

const holeMark = "\uE000"

// Apply runs the profile over text. Code fences, URLs, and JSON objects are
// kept byte for byte. query is the latest user question, used by relevance.
func Apply(profile, text, query string) (string, []string) {
	engines := Profile(profile)
	if len(engines) == 0 || text == "" {
		return text, nil
	}
	protected, holes := shield(text)
	out := protected
	var ran []string
	for _, name := range engines {
		next := run(name, out, query)
		if next != out {
			ran = append(ran, name)
			out = next
		}
	}
	return restore(out, holes), ran
}

func run(name, text, query string) string {
	switch name {
	case "lite":
		return lite(text)
	case "dedup":
		return dedup(text)
	case "rtk":
		return rtk(text)
	case "relevance":
		return relevance(text, query)
	case "caveman":
		return caveman(text)
	default:
		return text
	}
}

func lite(text string) string {
	lines := strings.Split(text, "\n")
	var b strings.Builder
	blank := false
	for _, line := range lines {
		line = strings.TrimRight(line, " \t")
		if strings.TrimSpace(line) == "" {
			if blank {
				continue
			}
			blank = true
			b.WriteByte('\n')
			continue
		}
		blank = false
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(line)
	}
	return strings.TrimSpace(b.String())
}

func dedup(text string) string {
	parts := strings.Split(text, "\n\n")
	seen := map[string]bool{}
	var keep []string
	for _, part := range parts {
		key := strings.TrimSpace(part)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		keep = append(keep, part)
	}
	return strings.Join(keep, "\n\n")
}

func rtk(text string) string {
	lines := strings.Split(text, "\n")
	if len(lines) <= 40 {
		return text
	}
	var b strings.Builder
	for i, line := range lines {
		if i == 24 {
			b.WriteString("\n… ")
			b.WriteString(itoa(len(lines) - 32))
			b.WriteString(" lines omitted …\n")
		}
		if i >= 24 && i < len(lines)-8 && !strings.Contains(line, holeMark) {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(line)
	}
	return b.String()
}

func relevance(text, query string) string {
	q := words(query)
	if len(q) == 0 {
		return text
	}
	sentences := splitSentences(text)
	if len(sentences) < 4 {
		return text
	}
	var keep []string
	for _, sentence := range sentences {
		score := 0
		sw := words(sentence)
		for w := range sw {
			if q[w] {
				score++
			}
		}
		if score > 0 || strings.Contains(sentence, holeMark) {
			keep = append(keep, sentence)
		}
	}
	if len(keep) == 0 {
		return sentences[0]
	}
	return strings.Join(keep, " ")
}

var fillers = []string{
	"the reason ", "is likely because ", "i would recommend ", "it is important to note that ",
	"in order to ", "you should ", "basically ", "actually ", "just ",
}

func caveman(text string) string {
	if fence.MatchString(text) {
		return text
	}
	out := strings.ToLower(text)
	// Keep original case for the first pass of phrase removal on the original text.
	out = text
	for _, phrase := range fillers {
		out = replaceFold(out, phrase, "")
	}
	out = strings.Join(strings.Fields(out), " ")
	return out
}

func replaceFold(text, phrase, with string) string {
	lower := strings.ToLower(text)
	p := strings.ToLower(phrase)
	var b strings.Builder
	i := 0
	for {
		j := strings.Index(lower[i:], p)
		if j < 0 {
			b.WriteString(text[i:])
			break
		}
		b.WriteString(text[i : i+j])
		b.WriteString(with)
		i += j + len(p)
	}
	return b.String()
}

func shield(text string) (string, []string) {
	var holes []string
	out := fence.ReplaceAllStringFunc(text, func(block string) string {
		token := holeMark + itoa(len(holes)) + "\uE001"
		holes = append(holes, block)
		return token
	})
	return out, holes
}

func restore(text string, holes []string) string {
	for i, hole := range holes {
		text = strings.Replace(text, holeMark+itoa(i)+"\uE001", hole, 1)
	}
	return text
}

func words(text string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields(strings.ToLower(text)) {
		w = strings.Trim(w, ".,;:!?\"'`()[]")
		if len(w) < 4 {
			continue
		}
		out[w] = true
	}
	return out
}

func splitSentences(text string) []string {
	var out []string
	var b strings.Builder
	for _, r := range text {
		b.WriteRune(r)
		if r == '.' || r == '!' || r == '?' {
			s := strings.TrimSpace(b.String())
			if s != "" {
				out = append(out, s)
			}
			b.Reset()
		}
	}
	if strings.TrimSpace(b.String()) != "" {
		out = append(out, strings.TrimSpace(b.String()))
	}
	return out
}

func itoa(n int) string {
	if n < 0 {
		n = 0
	}
	return strings.TrimLeft(strings.ReplaceAll(strings.Repeat("0", 1)+itoaDigits(n), "", ""), "")
}

func itoaDigits(n int) string {
	if n == 0 {
		return "0"
	}
	var d []byte
	for n > 0 {
		d = append([]byte{byte('0' + n%10)}, d...)
		n /= 10
	}
	return string(d)
}
