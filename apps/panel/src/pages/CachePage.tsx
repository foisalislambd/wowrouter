import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { getCache, saveCache } from "@/lib/api";
import { useEffect, useState } from "react";

export default function CachePage() {
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getCache()
      .then((result) => setEnabled(result.enabled))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    setError("");
    try {
      await saveCache(next);
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : "Could not save cache");
    }
  }

  return (
    <div>
      <PanelPageHeader title="Cache" />
      <p className="mb-4 max-w-2xl text-sm text-gray-500">
        Exact response cache keeps a copy of a completed chat when the model, messages, and settings match. Turn it off when you are measuring latency.
      </p>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <label className="panel-card flex items-center justify-between panel-card-body">
        <span className="text-sm font-medium text-gray-900 dark:text-white">Reuse identical responses</span>
        <input type="checkbox" checked={enabled} onChange={(event) => void toggle(event.target.checked)} />
      </label>
    </div>
  );
}
