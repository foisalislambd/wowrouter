import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { listKeys, saveKeyLimits, type RouterKey } from "@/lib/api";
import { useEffect, useState, type FormEvent } from "react";

export default function BudgetsPage() {
  const [keys, setKeys] = useState<RouterKey[]>([]);
  const [keyId, setKeyId] = useState("");
  const [monthly, setMonthly] = useState("50");
  const [rpm, setRpm] = useState("60");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    listKeys()
      .then((result) => {
        setKeys(result.keys);
        if (result.keys[0]) setKeyId(result.keys[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaved("");
    try {
      await saveKeyLimits(keyId, Number(monthly), Number(rpm));
      setSaved("Saved on that key.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save limits");
    }
  }

  return (
    <div>
      <PanelPageHeader title="Budgets" />
      <p className="mb-4 max-w-2xl text-sm text-gray-500">
        A monthly dollar cap and a per-minute request cap apply to one router key. The gateway stops that key when a hard cap is hit.
      </p>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <form onSubmit={onSubmit} className="panel-card panel-card-body grid max-w-lg gap-3">
        <select
          value={keyId}
          onChange={(event) => setKeyId(event.target.value)}
          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        >
          {keys.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Monthly USD
          <input value={monthly} onChange={(event) => setMonthly(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 dark:border-gray-700 dark:bg-white/5 dark:text-white" />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Requests per minute
          <input value={rpm} onChange={(event) => setRpm(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 dark:border-gray-700 dark:bg-white/5 dark:text-white" />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-brand-500 text-sm font-semibold text-white">
          Save limits
        </button>
        {saved && <p className="text-sm text-success-600">{saved}</p>}
      </form>
    </div>
  );
}
