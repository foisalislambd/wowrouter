import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { addMemory, deleteMemory, listMemories, type MemoryNote } from "@/lib/api";
import { useEffect, useState, type FormEvent } from "react";

export default function MemoryPage() {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listMemories()
      .then((result) => setNotes(result.memories))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await addMemory(body.trim());
      setNotes((current) => [saved, ...current]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError("");
    try {
      await deleteMemory(id);
      setNotes((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the note");
    }
  }

  return (
    <div>
      <PanelPageHeader title="Memory" />
      <p className="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
        Notes are prepended to chat calls only when Memory is turned on in Settings. A request can skip them with the header X-WowRouter-No-Memory: 1.
      </p>
      {error && <p className="mb-4 text-sm text-error-500">{error}</p>}
      <form onSubmit={onAdd} className="panel-card panel-card-body mb-4 space-y-3">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="A note the router should remember, such as the reply language you prefer."
          className="min-h-24 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-white/5 dark:text-white"
        />
        <button type="submit" disabled={busy || body.trim() === ""} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
          Save note
        </button>
      </form>
      <div className="grid gap-3">
        {notes.map((note) => (
          <section key={note.id} className="panel-card panel-card-body flex items-start justify-between gap-3">
            <p className="text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-100">{note.body}</p>
            <button type="button" onClick={() => onDelete(note.id)} className="shrink-0 text-sm text-error-500">
              Delete
            </button>
          </section>
        ))}
        {notes.length === 0 && <p className="text-sm text-gray-500">No notes yet.</p>}
      </div>
    </div>
  );
}
