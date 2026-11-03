import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { Bars } from "@/components/ui/bars";
import { EmptyState, ErrorNote, LoadingBlock } from "@/components/ui/feedback";
import { getUsage, type UsageDay, type UsageRow } from "@/lib/api";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export default function UsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [days, setDays] = useState<UsageDay[]>([]);
  const [range, setRange] = useState(14);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getUsage(range)
      .then((result) => {
        setRows(result.rows);
        setDays(result.days ?? []);
        setTotals(result.totals);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div>
      <PanelPageHeader
        title="Usage"
        description="Requests, tokens, and catalog cost for calls stored on this computer."
        actions={
          <select aria-label="Date range" value={range} onChange={(event) => setRange(Number(event.target.value))} className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-white/5 dark:text-white">
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      {loading && <LoadingBlock label="Loading usage…" />}
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
      {days.length > 0 && (
        <div className="mb-4">
          <Bars points={days.map((day) => ({ key: day.day, label: day.day.slice(5), value: day.requests, title: `${day.day}: ${day.requests} requests, ${money(day.costUsd)}` }))} />
        </div>
      )}
      <div className="panel-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No requests in this range" body="Usage is counted from calls the router handled. Send one from a client or the playground." action={<Link to="/playground" className="text-sm font-medium text-brand-600">Open playground</Link>} />
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
