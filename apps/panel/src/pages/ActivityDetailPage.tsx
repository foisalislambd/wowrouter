import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { getActivity } from "@/lib/api";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

export default function ActivityDetailPage() {
  const { id = "" } = useParams();
  const [item, setItem] = useState<Awaited<ReturnType<typeof getActivity>> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getActivity(id)
      .then(setItem)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  const request = item?.requestJson?.trim() ?? "";

  return (
    <div>
      <PanelPageHeader
        title="Request"
      />
      <Link to="/activity" className="mb-4 inline-block text-sm text-brand-500 hover:underline">
        Back to activity
      </Link>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      {item && (
        <div className="space-y-4">
          <div className="panel-card panel-card-body grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">When</p>
              <p className="mt-1 text-sm">{item.createdAt.replace("T", " ").replace("Z", "")}</p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Source</p>
              <p className="mt-1 text-sm">{item.source}</p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Model</p>
              <p className="mt-1 font-mono text-xs">{item.modelId || "—"}</p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Status</p>
              <p className={`mt-1 text-sm ${item.statusCode >= 400 ? "text-error-500" : "text-success-600"}`}>{item.statusCode}</p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Latency</p>
              <p className="mt-1 text-sm">{item.latencyMs} ms</p>
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Tokens</p>
              <p className="mt-1 text-sm text-gray-500">
                {item.promptTokens || item.completionTokens ? `${item.promptTokens} / ${item.completionTokens}` : "—"}
              </p>
            </div>
            {item.errorMessage && <p className="text-sm text-gray-600 sm:col-span-3 dark:text-gray-300">{item.errorMessage}</p>}
          </div>
          <div className="panel-card overflow-hidden">
            {request ? (
              <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-gray-800 dark:text-gray-100">{pretty(request)}</pre>
            ) : (
              <p className="p-4 text-sm text-gray-500">This request was logged before the provider call was stored.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function pretty(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
