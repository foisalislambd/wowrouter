import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { getUsage, type UsageRow } from "@/lib/api";
import { useEffect, useState } from "react";

export default function AnalyticsPage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getUsage()
      .then((result) => setRows(result.rows))
      .catch((err: Error) => setError(err.message));
  }, []);

  const max = Math.max(1, ...rows.map((row) => row.requests));

  return (
    <div>
      <PanelPageHeader title="Analytics" />
      <p className="mb-4 text-sm text-gray-500">Requests recorded in this data folder, grouped by model.</p>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <div className="panel-card panel-card-body space-y-3">
        {rows.length === 0 && <p className="text-sm text-gray-500">No calls yet.</p>}
        {rows.map((row) => (
          <div key={row.modelId}>
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span className="font-mono">{row.modelId}</span>
              <span>
                {row.requests} calls · {row.errors} errors
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10">
              <div className="h-2 rounded-full bg-brand-500" style={{ width: `${(row.requests / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
