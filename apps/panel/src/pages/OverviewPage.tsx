import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { Bars } from "@/components/ui/bars";
import { CopyButton, ErrorNote, LoadingBlock } from "@/components/ui/feedback";
import { getDashboard, type Dashboard } from "@/lib/api";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export default function OverviewPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    getDashboard()
      .then((next) => {
        if (!cancel) setData(next);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div>
      <PanelPageHeader
        title="Overview"
        description="One local endpoint and one router key for every coding agent. Provider keys stay on this computer."
        actions={data ? <CopyButton text={data.endpoint} label="Copy endpoint" /> : <Link to="/providers" className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white">Add a provider</Link>}
      />
      <ErrorNote>{error}</ErrorNote>
      {!data && !error && <LoadingBlock label="Loading overview…" />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Today's requests" value={String(data.today.requests)} />
            <Stat label="Today's cost" value={money(data.today.costUsd)} />
            <Stat label="Errors today" value={String(data.today.errors)} />
            <Stat label="Avg latency" value={data.today.requests ? `${data.today.avgLatencyMs} ms` : "—"} />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            {data.enabledProviders} ready providers · {data.activeModels} active models · {data.routerKeys} router keys · <span className="font-mono">{data.endpoint}</span>
          </p>
          <div className="mt-4">
            <Bars
              points={(data.days ?? []).map((day) => ({
                key: day.day,
                label: day.day.slice(5),
                value: day.requests,
                title: `${day.day}: ${day.requests} requests, ${money(day.costUsd)}`,
              }))}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="panel-card panel-card-body">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Setup</h2>
              <ol className="mt-3 space-y-2">
                {data.steps.map((step, index) => (
                  <li key={step.id}>
                    <Link to={step.href} className="flex items-start gap-2 text-sm text-gray-700 hover:text-brand-600 dark:text-gray-200">
                      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${step.done ? "bg-success-50 text-success-600" : "bg-gray-100 text-gray-600 dark:bg-white/10"}`}>
                        {step.done ? "✓" : index + 1}
                      </span>
                      {step.label}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
            <section className="panel-card overflow-hidden">
              <h2 className="px-4 pt-4 text-sm font-semibold text-gray-900 dark:text-white">Provider health</h2>
              {data.providerHealth.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500">No calls yet. Send one from the playground or a coding agent.</p>
              ) : (
                <table className="mt-2 w-full text-left text-sm">
                  <tbody>
                    {data.providerHealth.map((row) => (
                      <tr key={row.provider} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-4 py-2 font-medium">{row.provider || "—"}</td>
                        <td className="px-4 py-2 text-gray-500">{row.requests} calls</td>
                        <td className={`px-4 py-2 ${row.errors ? "text-error-500" : "text-gray-500"}`}>{row.errors} errors</td>
                        <td className="px-4 py-2 text-gray-500">{row.avgLatencyMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
          <section className="panel-card mt-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Top models</h2>
              <Link to="/usage" className="text-sm text-brand-600">Usage</Link>
            </div>
            {data.topModels.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-500">Top models appear after the first stored call.</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {data.topModels.map((row) => (
                    <tr key={row.modelId} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 font-mono text-xs">{row.modelId || "—"}</td>
                      <td className="px-4 py-2">{row.requests}</td>
                      <td className="px-4 py-2 text-gray-500">{money(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-card p-4">
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}
