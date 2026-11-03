package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSystemOneEndpoint(t *testing.T) {
	if got := systemOneEndpoint("https://api.typesafe.ai/v1", "typesafe"); got != "https://api.typesafe.ai/v1/systemone" {
		t.Fatal(got)
	}
	if got := systemOneEndpoint("https://api.upstage.ai/v1/solar", "upstage"); got != "https://api.upstage.ai/v1/systemone" {
		t.Fatal(got)
	}
	if got := systemOneEndpoint("https://api.typesafe.ai/v1/systemone", "typesafe"); got != "https://api.typesafe.ai/v1/systemone" {
		t.Fatal(got)
	}
}

func TestTevChatBodyUsesLetters(t *testing.T) {
	body := []byte(`{
		"model": "together/togethercomputer/Tev1-4B-experimental",
		"state": "the checkout page is blank",
		"questions": {
			"team": {
				"type": "choice",
				"instructions": "Which team should own this?",
				"criteria": {"billing": "payments", "frontend": "rendering"}
			}
		}
	}`)
	chat, letters, err := tevChatBody("togethercomputer/Tev1-4B-experimental", body)
	if err != nil {
		t.Fatal(err)
	}
	if letters["A"] != "billing" || letters["B"] != "frontend" {
		t.Fatalf("letters %#v", letters)
	}
	var parsed struct {
		Temperature float64 `json:"temperature"`
		MaxTokens   int     `json:"max_tokens"`
		Messages    []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(chat, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Temperature != 0 || parsed.MaxTokens != 8 || len(parsed.Messages) != 2 {
		t.Fatalf("%#v", parsed)
	}
	if !strings.Contains(parsed.Messages[1].Content, `"A"`) || !strings.Contains(parsed.Messages[1].Content, "payments") {
		t.Fatal(parsed.Messages[1].Content)
	}
}

func TestTevAnswerMapsLetter(t *testing.T) {
	raw := []byte(`{"model":"tev","choices":[{"message":{"content":"B"}}],"usage":{"prompt_tokens":10,"completion_tokens":1}}`)
	out, prompt, completion := tevAnswer(raw, map[string]string{"A": "billing", "B": "frontend", "__question": "team"})
	if prompt != 10 || completion != 1 {
		t.Fatal(prompt, completion)
	}
	var parsed struct {
		Answers map[string]struct {
			Letter string `json:"letter"`
			Choice string `json:"choice"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Answers["team"].Letter != "B" || parsed.Answers["team"].Choice != "frontend" {
		t.Fatalf("%#v", parsed.Answers)
	}
}

func TestRewriteDecisionRequiresQuestions(t *testing.T) {
	_, err := rewriteDecisionModel([]byte(`{"model":"x","state":"hi"}`), "jev-1.13")
	if err == nil {
		t.Fatal("expected questions error")
	}
	_, err = rewriteDecisionModel([]byte(`{"model":"x","state":"hi","questions":[]}`), "jev-1.13")
	if err == nil {
		t.Fatal("expected object questions")
	}
}

func TestTevRejectsExtraQuestions(t *testing.T) {
	body := []byte(`{"state":"hi","questions":{"a":{"type":"noul","instructions":"Yes?"},"b":{"type":"noul","instructions":"No?"}}}`)
	_, _, err := tevChatBody("togethercomputer/Tev1-4B-experimental", body)
	if err == nil || !strings.Contains(err.Error(), "one question") {
		t.Fatal(err)
	}
}

func TestOptionLetterIgnoresProse(t *testing.T) {
	letters := map[string]string{"A": "billing", "B": "frontend", "__question": "team", "__type": "choice"}
	if got := optionLetter("The answer is B", letters); got != "B" {
		t.Fatal(got)
	}
	if got := optionLetter("A or B", letters); got != "" {
		t.Fatal(got)
	}
	raw := []byte(`{"model":"tev","choices":[{"message":{"content":"The answer is B"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
	out, _, _ := tevAnswer(raw, letters)
	if !strings.Contains(string(out), `"type":"choice"`) || !strings.Contains(string(out), `"choice":"frontend"`) {
		t.Fatal(string(out))
	}
}
