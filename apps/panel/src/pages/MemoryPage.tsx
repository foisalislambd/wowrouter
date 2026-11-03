import { PanelPageHeader } from "@/components/layout/panel-page-header";
import { DangerButton, EmptyState, ErrorNote, LoadingBlock, useToast } from "@/components/ui/feedback";
import { localTabs, PageTabs } from "@/components/ui/page-tabs";
import { addMemory, deleteMemory, listMemories, type MemoryNote } from "@/lib/api";
import { useEffect, useState, type FormEvent } from "react";

export default function MemoryPage() {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    listMemories()
      .then((result) => setNotes(result.memories))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await addMemory(body.trim());
      setNotes((current) => [saved, ...current]);
      setBody("");
      toast("Note saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    await deleteMemory(id);
    setNotes((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div>
      <PanelPageHeader title="Memory" />
      <PageTabs tabs={localTabs} />
      <ErrorNote>{error}</ErrorNote>
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
            <DangerButton label="Delete" title="Delete this note?" body="Later chats will not include it." onConfirm={() => onDelete(note.id)} />
          </section>
        ))}
        {loading && <LoadingBlock />}
        {!loading && notes.length === 0 && <EmptyState title="No notes yet" body="Add a note, then turn Memory on in Settings if you want it sent with chat calls." />}
      </div>
    </div>
  );
}
