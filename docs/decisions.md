# Decisions

A decision model answers a structured question about some state. It is not a chat model. Cursor's normal chat box will not run it. Call `POST /v1/systemone`, or use the playground's decision box.

You still need a router key, a saved provider key, and the model turned on.

## A yes/no question

```bash
curl http://127.0.0.1:8787/v1/systemone \
  -H "Authorization: Bearer sk-airoute-..." \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"typesafe/jev-1.13\",\"state\":\"The user asked to delete the production database.\",\"questions\":{\"allow\":{\"type\":\"noul\",\"instructions\":\"Is this request safe to allow?\"}}}"
```

`state` is the situation, as text or JSON. `questions` is an object, not a list. Each key is your own id for that question.

The answer comes back under that same id. For a `noul` question the `noul` field is a probability from 0 to 1. Output tokens on these calls are not billed by the decision providers; input tokens are.

## Question types

| Type | You send | You get back |
| --- | --- | --- |
| `noul` | `instructions` | A yes/no probability in `noul` |
| `choice` | `instructions` and `criteria` with at least two options | The winning option, probabilities, and a confidence |
| `score` | `instructions` and `criteria` as a list of levels | The chosen level |

A choice looks like this:

```json
{
  "model": "typesafe/jev-1.13",
  "state": "The deploy failed after the migration.",
  "questions": {
    "next": {
      "type": "choice",
      "instructions": "What should happen next?",
      "criteria": {
        "rollback": "Revert the migration",
        "retry": "Run the deploy again",
        "wait": "Leave production as it is"
      }
    }
  }
}
```

`questions` has to be a JSON object with at least one question. An array is rejected.

## Playground

On **Playground**, pick a decision model.

- Plain text becomes the state, plus one yes/no question: "Is the answer yes?"
- JSON that already has `state` and `questions` is sent through. The model you picked replaces any model inside the JSON.

The response is shown as text on the page.

## Providers

| Provider | Notes |
| --- | --- |
| TypeSafe | System One at `https://api.typesafe.ai/v1`. Official keys belong there. Hosted `jv_live_` keys use a different host and will not work on that URL |
| Upstage Solar Decide | System One. The router adds `/systemone` to the base URL |
| Inception Mercury Decide | System One |
| Respan, Jared Palmer | No public base URL is built in. Paste a System One base URL on the provider page |
| Together Tev | Not System One. WowRouter turns one question into a short chat call and reads a single option letter back |

Tev accepts one question per request, with 2 to 24 options. A yes/no question becomes yes and no. Tev returns the letter it chose. It does not return a calibrated probability. If the reply names two different known letters, the answer is left empty.

## Chat by mistake

`POST /v1/chat/completions` with a decision model does not guess. The error tells you to call `POST /v1/systemone` with `state` and `questions`.
