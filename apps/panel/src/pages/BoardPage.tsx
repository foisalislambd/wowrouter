import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { deleteBoard, listBoard, saveBoard, type BoardItem } from "@/lib/api";
import { useEffect, useState, type FormEvent } from "react";

type Props = {
  kind: string;
  title: string;
  blurb: string;
  placeholder: string;
};

const empty = (): BoardItem => ({ id: "", title: "", detail: "", enabled: true, body: "" });

export default function BoardPage({ kind, title, blurb, placeholder }: Props) {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [draft, setDraft] = useState<BoardItem>(empty());
  const [error, setError] = useState("");

  function reload() {
    listBoard(kind)
      .then((result) => setItems(result.items))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    reload();
  }, [kind]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await saveBoard(kind, draft);
      setDraft(empty());
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function onDelete(id: string) {
    setError("");
    try {
      await deleteBoard(kind, id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <div>
      <PanelPageHeader title={title} />
      <p className="mb-4 max-w-2xl text-sm text-gray-500">{blurb}</p>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <form onSubmit={onSave} className="panel-card panel-card-body mb-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Name"
            className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-white/5 dark:text-white"
          />
          <input
            value={draft.detail}
            onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            placeholder="Short note"
            className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-white/5 dark:text-white"
          />
        </div>
        <textarea
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          placeholder={placeholder}
          rows={5}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          Enabled
        </label>
        <div>
          <button type="submit" className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white">
            {draft.id ? "Update" : "Add"}
          </button>
        </div>
      </form>
      <div className="panel-card overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Nothing here yet.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
                <button type="button" className="min-w-0 text-left" onClick={() => setDraft(item)}>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{item.title || item.id}</p>
                  <p className="truncate text-xs text-gray-500">{item.detail || item.id}</p>
                </button>
                <button type="button" onClick={() => onDelete(item.id)} className="text-sm text-error-500">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
