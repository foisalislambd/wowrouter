package compress

import "testing"

func TestLiteCollapsesBlankLines(t *testing.T) {
	in := "a\n\n\n\nb  \n"
	got, ran := Apply("lite", in, "")
	if got != "a\n\nb" || len(ran) != 1 {
		t.Fatalf("%q %v", got, ran)
	}
}

func TestDedupDropsRepeatedBlocks(t *testing.T) {
	in := "same block\n\nsame block\n\nnext"
	got, _ := Apply("standard", in, "")
	if got == in || !contains(got, "same block") || count(got, "same block") != 1 {
		t.Fatalf("%q", got)
	}
}

func TestRTKTruncatesLongToolOutput(t *testing.T) {
	var lines []string
	for i := 0; i < 80; i++ {
		lines = append(lines, "line")
	}
	got, ran := Apply("rtk", join(lines), "")
	if !contains(got, "omitted") {
		t.Fatalf("%s %v", got, ran)
	}
}

func TestCavemanKeepsCodeFences(t *testing.T) {
	in := "I would recommend this.\n```\nkeep me\n```"
	got, _ := Apply("standard", in, "")
	if !contains(got, "```\nkeep me\n```") {
		t.Fatalf("%q", got)
	}
}

func TestRelevanceDropsUnrelatedSentences(t *testing.T) {
	in := "The database index is missing on the user id. Cats enjoy sunshine in the afternoon. The migration adds that index. Birds migrate south every year."
	got, _ := Apply("aggressive", in, "why is the user id index missing")
	if !contains(got, "index") || contains(got, "sunshine") {
		t.Fatalf("%q", got)
	}
}

func TestRTKKeepsAFenceInsideTheOmittedSpan(t *testing.T) {
	var lines []string
	for i := 0; i < 30; i++ {
		lines = append(lines, "noise")
	}
	lines = append(lines, "```", "SECRET", "```")
	for i := 0; i < 20; i++ {
		lines = append(lines, "tail")
	}
	got, _ := Apply("rtk", join(lines), "")
	if !contains(got, "SECRET") || !contains(got, "```") {
		t.Fatalf("%s", got)
	}
}

func TestIdenticalFencesBothSurviveDedup(t *testing.T) {
	in := "```\nsame\n```\n\n```\nsame\n```"
	got, _ := Apply("standard", in, "")
	if count(got, "```") != 4 || count(got, "same") != 2 {
		t.Fatalf("%q", got)
	}
}

func TestNullByteIsNotAFencePlaceholder(t *testing.T) {
	in := "keep\x00this ```code```"
	got, _ := Apply("lite", in, "")
	if !contains(got, "\x00") || !contains(got, "code") {
		t.Fatalf("%q", got)
	}
}

func TestOffIsIdentity(t *testing.T) {
	if got, ran := Apply("off", "hello", ""); got != "hello" || ran != nil {
		t.Fatalf("%q %v", got, ran)
	}
	if len(Engines()) != 7 || len(NotImplemented()) < 4 {
		t.Fatal("engine lists")
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (s == sub || len(s) > 0 && indexOf(s, sub) >= 0))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func count(s, sub string) int {
	n := 0
	for indexOf(s, sub) >= 0 {
		i := indexOf(s, sub)
		n++
		s = s[i+len(sub):]
	}
	return n
}

func join(lines []string) string {
	out := ""
	for i, line := range lines {
		if i > 0 {
			out += "\n"
		}
		out += line
	}
	return out
}
