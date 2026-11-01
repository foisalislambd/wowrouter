import { checkSafety } from "@/lib/api";
import BoardPage from "@/pages/BoardPage";
import { useState, type FormEvent } from "react";

export default function SafetyPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function onCheck(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const next = await checkSafety(text);
      setResult(next.blocked ? `Blocked. ${next.hits.map((hit) => hit.Detail || hit.Name).join(" ")}` : `Allowed. ${next.text}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    }
  }

  return (
    <div className="space-y-8">
      <BoardPage
        kind="guardrails"
        title="Safety"
        blurb="Guardrails run on the way in and on the way out. A keyword rule, a PII rule, or a JSON schema can flag, redact, or block."
        placeholder='{"type":"keywords","action":"block","order":1,"keywords":{"terms":["drop-this"]}}'
      />
      <form onSubmit={onCheck} className="panel-card panel-card-body space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Try a phrase</h2>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <button type="submit" className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white">
          Run guardrails
        </button>
        {error && <p className="text-sm text-error-500">{error}</p>}
        {result && <p className="text-sm text-gray-700 dark:text-gray-200">{result}</p>}
      </form>
    </div>
  );
}
