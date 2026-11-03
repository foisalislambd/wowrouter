import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { getUsage, type UsageRow } from "@/lib/api";
import { useEffect, useState } from "react";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export default function UsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [totals, setTotals] = useState({ requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    getUsage()
      .then((result) => {
        setRows(result.rows);
        setTotals(result.totals);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div>
      <PanelPageHeader
        title="Usage"
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ["Requests", String(totals.requests)],
          ["Errors", String(totals.errors)],
          ["Tokens", `${totals.promptTokens} / ${totals.completionTokens}`],
          ["Estimated cost", money(totals.costUsd)],
        ].map(([label, value]) => (
          <div key={label} className="panel-card panel-card-body">
            <p className="text-xs tracking-wide text-gray-500 uppercase">{label}</p>
            <p className="mt-1 text-lg font-medium text-gray-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="panel-card overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-gray-200 text-xs tracking-wide text-gray-500 uppercase dark:border-gray-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Requests</th>
                  <th className="px-4 py-3 font-medium">Errors</th>
                  <th className="px-4 py-3 font-medium">Prompt</th>
                  <th className="px-4 py-3 font-medium">Completion</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.modelId} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                    <td className="px-4 py-3 font-mono text-xs">{row.modelId || "—"}</td>
                    <td className="px-4 py-3">{row.requests}</td>
                    <td className={`px-4 py-3 ${row.errors ? "text-error-500" : "text-gray-500"}`}>{row.errors}</td>
                    <td className="px-4 py-3 text-gray-500">{row.promptTokens}</td>
                    <td className="px-4 py-3 text-gray-500">{row.completionTokens}</td>
                    <td className="px-4 py-3">{money(row.costUsd)}</td>
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
