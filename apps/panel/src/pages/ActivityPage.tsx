import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { listActivity, type ActivityItem } from "@/lib/api";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listActivity()
      .then((result) => setItems(result.activity))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <PanelPageHeader
        title="Activity"
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <div className="panel-card overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-gray-200 text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Latency</th>
                  <th className="px-4 py-3 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5">
                    <td className="px-4 py-3 text-gray-500">
                      <Link to={`/activity/${item.id}`} className="hover:text-brand-500">
                        {item.createdAt.replace("T", " ").replace("Z", "")}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{item.source}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.modelId || "—"}</td>
                    <td className={`px-4 py-3 ${item.statusCode >= 400 ? "text-error-500" : "text-success-600"}`}>
                      {item.statusCode}
                      {item.errorMessage && <span className="mt-1 block max-w-xs text-xs text-gray-500">{item.errorMessage}</span>}
                    </td>
                    <td className="px-4 py-3">{item.latencyMs} ms</td>
                    <td className="px-4 py-3 text-gray-500">
                      {item.promptTokens || item.completionTokens
                        ? `${item.promptTokens} / ${item.completionTokens}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
