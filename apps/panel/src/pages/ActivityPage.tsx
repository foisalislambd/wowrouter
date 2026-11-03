import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { activityTabs, PageTabs } from "@/components/ui/page-tabs";
import { ConfirmDialog, EmptyState, ErrorNote, LoadingBlock, useToast } from "@/components/ui/feedback";
import { clearActivity, listActivity, type ActivityItem } from "@/lib/api";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const pageSize = 25;

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setQuery(q.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    listActivity({ q: query, status, limit: pageSize, offset })
      .then((result) => {
        if (cancel) return;
        setItems(result.activity);
        setTotal(result.total ?? result.activity.length);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [query, status, offset]);

  return (
    <div>
      <PanelPageHeader
        title="Activity"
        description="Every call this router stored, with the model, status, and latency."
        actions={
          <>
            <a href="/api/activity/export" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-200">Export CSV</a>
            <button type="button" className="rounded-lg border border-error-200 px-3 py-2 text-sm font-medium text-error-500" onClick={() => setConfirmClear(true)}>Clear</button>
          </>
        }
      />
      <PageTabs tabs={activityTabs} />
      <ErrorNote>{error}</ErrorNote>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Filter by model, source, or error" aria-label="Filter activity" className="h-10 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-white/5 dark:text-white" />
        <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} aria-label="Status" className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-white/5 dark:text-white">
          <option value="all">All statuses</option>
          <option value="ok">Success</option>
          <option value="error">Errors</option>
        </select>
      </div>
      {loading ? <LoadingBlock label="Loading activity…" /> : items.length === 0 ? (
        <EmptyState title="No matching requests" body="Calls from the playground, Cursor, or another client show up here. Try another filter, or send a test from the playground." action={<Link to="/playground" className="text-sm font-medium text-brand-600">Open playground</Link>} />
      ) : (
        <div className="panel-card overflow-x-auto">
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
                    <Link to={`/activity/${item.id}`} className="hover:text-brand-500">{item.createdAt.replace("T", " ").replace("Z", "")}</Link>
                  </td>
                  <td className="px-4 py-3">{item.source}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {item.modelId || "—"}
                    {item.routeNote && <span className="mt-1 block text-[11px] text-gray-500">{item.routeNote}</span>}
                  </td>
                  <td className={`px-4 py-3 ${item.statusCode >= 400 ? "text-error-500" : "text-success-600"}`}>
                    {item.statusCode}
                    {item.errorMessage && <span className="mt-1 block max-w-xs text-xs text-gray-500">{item.errorMessage}</span>}
                  </td>
                  <td className="px-4 py-3">{item.latencyMs} ms</td>
                  <td className="px-4 py-3 text-gray-500">{item.promptTokens || item.completionTokens ? `${item.promptTokens} / ${item.completionTokens}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>{total} stored</span>
        <div className="flex gap-2">
          <button type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40 dark:border-gray-700">Previous</button>
          <button type="button" disabled={offset + pageSize >= total} onClick={() => setOffset((value) => value + pageSize)} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40 dark:border-gray-700">Next</button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmClear}
        title="Clear request logs?"
        body="This deletes the stored calls on this computer. It does not change provider keys."
        confirmLabel="Clear logs"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clearActivity()
            .then(() => {
              setItems([]);
              setTotal(0);
              setConfirmClear(false);
              toast("Logs cleared");
            })
            .catch((err: Error) => {
              setError(err.message);
              setConfirmClear(false);
            });
        }}
      />
    </div>
  );
}
