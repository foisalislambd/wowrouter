import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { getOverview, listActivity, type ActivityItem, type Overview } from "@/lib/api";
import { Boxes, Check, Copy, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancel = false;
    Promise.all([getOverview(), listActivity()])
      .then(([nextOverview, nextActivity]) => {
        if (cancel) return;
        setOverview(nextOverview);
        setActivity(nextActivity.activity.slice(0, 5));
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function copyEndpoint() {
    if (!overview) return;
    await navigator.clipboard.writeText(overview.endpoint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <PanelPageHeader
        title="Overview"
      />
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Providers" value={overview?.providers ?? "—"} icon={<Boxes className="h-5 w-5 text-brand-600" />} />
        <Stat label="Active models" value={overview?.activeModels ?? "—"} icon={<Sparkles className="h-5 w-5 text-emerald-600" />} />
        <Stat label="Router keys" value={overview?.routerKeys ?? "—"} icon={<KeyRound className="h-5 w-5 text-violet-600" />} />
        <button type="button" onClick={copyEndpoint} className="panel-card p-4 text-left">
          <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Endpoint</p>
          <p className="mt-1 truncate font-mono text-sm font-semibold text-gray-900 dark:text-white">
            {overview?.endpoint ?? "—"}
          </p>
          <p className="mt-2 flex items-center gap-1 text-xs text-gray-500">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy base URL"}
          </p>
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="panel-card panel-card-body">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Start here</h2>
          <ol className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <li>1. Open a provider and save its API key.</li>
            <li>2. Turn on the models you want this router to expose.</li>
            <li>3. Create a router key and use it as the OpenAI API key in your app.</li>
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/providers" className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600">
              Providers
            </Link>
            <Link to="/keys" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">
              API keys
            </Link>
          </div>
        </section>
        <section className="panel-card panel-card-body">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No requests yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {activity.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900 dark:text-white">{item.modelId || "—"}</p>
                    <p className="text-xs text-gray-500">{item.source}</p>
                  </div>
                  <span className={item.statusCode >= 400 ? "text-error-500" : "text-success-600"}>{item.statusCode}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="panel-card flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{value}</p>
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-50 dark:bg-white/5">{icon}</div>
    </div>
  );
}
