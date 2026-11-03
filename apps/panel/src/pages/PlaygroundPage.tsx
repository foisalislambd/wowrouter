import { MarkdownView } from "@/components/markdown-view";
import { ModalityFlow } from "@/components/modalities";
import { getProvider, listActiveModels, type Model } from "@/lib/api";
import { providerIcon } from "@/lib/provider-icons";
import { chatDeltaFromSSE, readSSE } from "@wowrouter/sse";
import { ArrowUp, ChevronDown, PanelLeft, Paperclip, Plus, Search, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

type Attachment = { name: string; mime: string; url: string; text: string | null };
type MediaItem = { type: string; src: string };
type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  sendContent: string | Array<Record<string, unknown>>
  reasoning: string
  media: MediaItem[]
  files: Attachment[]
  error: string
  format: "markdown" | "json"
  request: unknown
};

type StoredChat = {
  id: string
  title: string
  updatedAt: number
  modelId: string
  messages: ChatMessage[]
};

const CHATS_KEY = "airoute.playground.chats";
const ACTIVE_KEY = "airoute.playground.active";
const OPEN_KEY = "airoute.playground.history";

function readChats(): StoredChat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHATS_KEY) || "[]") as StoredChat[];
    return Array.isArray(parsed) ? parsed.filter((chat) => chat && typeof chat.id === "string") : [];
  } catch {
    return [];
  }
}

export default function PlaygroundPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [modelId, setModelId] = useState(() => readChats().find((chat) => chat.id === localStorage.getItem(ACTIVE_KEY))?.modelId ?? "");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChats().find((chat) => chat.id === localStorage.getItem(ACTIVE_KEY))?.messages ?? []);
  const [chats, setChats] = useState<StoredChat[]>(readChats);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) || "");
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== "0");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    listActiveModels()
      .then((result) => {
        setModels(result.models);
        setModelId((current) => current || result.models[0]?.id || "");
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    const slugs = [...new Set(models.map((model) => model.providerSlug))];
    let cancel = false;
    Promise.all(
      slugs.map(async (slug) => {
        if (slug === "fallback") return ["fallback", "Fallback"] as const;
        try {
          const provider = await getProvider(slug);
          return [slug, provider.displayName] as const;
        } catch {
          return [slug, slug] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancel) setNames(Object.fromEntries(pairs));
    });
    return () => {
      cancel = true;
    };
  }, [models]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [prompt]);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !activeId) return;
    setChats((current) =>
      current.map((chat) =>
        chat.id === activeId ? { ...chat, title: chatTitle(messages), updatedAt: Date.now(), modelId, messages: forStorage(messages) } : chat,
      ),
    );
  }, [messages, activeId, modelId, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
        localStorage.setItem(ACTIVE_KEY, activeId);
        localStorage.setItem(OPEN_KEY, historyOpen ? "1" : "0");
      } catch {
        localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 8)));
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [chats, activeId, historyOpen, ready]);

  const selected = models.find((model) => model.id === modelId);
  const kind = selected?.kind || "chat";
  const mediaKind = kind === "image" || kind === "video" || kind === "audio";
  const decisionKind = kind === "decisions";

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const next: Attachment[] = [];
    for (const file of Array.from(list)) {
      const mime = file.type || "application/octet-stream";
      const text = isTextFile(file) ? (await file.text()).slice(0, 100_000) : null;
      next.push({ name: file.name, mime, url: await readFile(file), text });
    }
    setFiles((current) => [...current, ...next].slice(0, 8));
  }

  function stop() {
    abortRef.current?.abort();
  }

  function beginChat() {
    if (activeId && chats.some((chat) => chat.id === activeId)) return;
    const id = activeId || newId();
    if (!activeId) setActiveId(id);
    setChats((current) => [{ id, title: chatTitle(messagesRef.current), updatedAt: Date.now(), modelId, messages: [] }, ...current.filter((chat) => chat.id !== id)].slice(0, 40));
  }

  function startNewChat() {
    abortRef.current?.abort();
    setActiveId("");
    setMessages([]);
    setPrompt("");
    setFiles([]);
  }

  function openChat(chat: StoredChat) {
    if (chat.id === activeId) return;
    abortRef.current?.abort();
    setActiveId(chat.id);
    setMessages(chat.messages);
    if (chat.modelId) setModelId(chat.modelId);
    setPrompt("");
    setFiles([]);
    if (window.innerWidth < 640) setHistoryOpen(false);
  }

  function deleteChat(id: string) {
    setChats((current) => current.filter((chat) => chat.id !== id));
    if (id === activeId) startNewChat();
  }

  async function send() {
    const text = prompt.trim();
    if (busy || !modelId || (!text && files.length === 0)) return;
    beginChat();
    const attached = files;
    const user: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      sendContent: attached.length === 0 ? text : messageContent(text, attached),
      reasoning: "",
      media: [],
      files: attached,
      error: "",
      format: "markdown",
      request: null,
    };
    const assistant: ChatMessage = {
      id: newId(),
      role: "assistant",
      text: "",
      sendContent: "",
      reasoning: "",
      media: [],
      files: [],
      error: "",
      format: "markdown",
      request: null,
    };
    const history = [...messagesRef.current, user];
    stick.current = true;
    setMessages([...history, assistant]);
    setPrompt("");
    setFiles([]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (decisionKind) {
        const response = await fetch("/api/playground/decision", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decisionRequest(modelId, text)),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; request?: unknown; response?: unknown };
        if (!response.ok) {
          patch(assistant.id, { request: data.request ?? null });
          throw new Error(data.error || response.statusText);
        }
        patch(assistant.id, { request: data.request ?? null, text: JSON.stringify(data.response ?? {}, null, 2) });
        return;
      }

      if (mediaKind) {
        const image = attached.find((file) => file.mime.startsWith("image/"))?.url ?? "";
        const notes = attached
          .filter((file) => file.text)
          .map((file) => `File ${file.name}:\n${file.text}`)
          .join("\n\n");
        const response = await fetch("/api/playground/media", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, prompt: notes ? `${text}\n\n${notes}` : text, image }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; media?: MediaItem[]; request?: unknown };
        if (!response.ok) {
          patch(assistant.id, { request: data.request ?? null });
          throw new Error(data.error || response.statusText);
        }
        const media = data.media ?? [];
        patch(assistant.id, { request: data.request ?? null, media, text: media.length === 0 ? "The provider returned no image, video, or audio." : "" });
        return;
      }

      const response = await fetch("/api/playground/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          stream: true,
          messages: history
            .filter((item) => !item.error && (item.role === "user" || item.text))
            .map((item) => ({ role: item.role, content: item.role === "assistant" ? item.text : item.sendContent })),
        }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; request?: unknown };
        patch(assistant.id, { request: data.request ?? null });
        throw new Error(data.error || response.statusText);
      }
      let reply = "";
      let thought = "";
      for await (const message of readSSE(response.body)) {
        if (message.event === "request") {
          patch(assistant.id, { request: parseRequest(message.data) });
          continue;
        }
        const delta = chatDeltaFromSSE(message.data);
        if (delta.error) throw new Error(delta.error);
        if (delta.done) break;
        if (delta.reasoning) {
          thought += delta.reasoning;
          patch(assistant.id, { reasoning: thought });
        }
        if (delta.content) {
          reply += delta.content;
          patch(assistant.id, { text: reply, media: mediaInText(reply) });
        }
      }
      if (!reply && !thought) patch(assistant.id, { text: "The model returned an empty reply." });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((current) => current.filter((item) => item.id !== assistant.id || item.text || item.reasoning || item.media.length > 0));
        return;
      }
      patch(assistant.id, { error: err instanceof Error ? err.message : "Request failed" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function patch(id: string, change: Partial<ChatMessage>) {
    setMessages((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  const orderedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="relative flex min-h-0 flex-1 bg-white dark:bg-gray-900">
      {historyOpen && <button type="button" aria-label="Close chat history" className="absolute inset-0 z-20 bg-gray-900/30 sm:hidden" onClick={() => setHistoryOpen(false)} />}
      <aside className={`${historyOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-30 w-64 flex-col border-r border-gray-200 bg-gray-50 sm:static dark:border-gray-800 dark:bg-gray-900`}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800">
          <span className="text-sm font-medium text-gray-900 dark:text-white">Chats</span>
          <button type="button" onClick={() => setHistoryOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-200/70 dark:hover:bg-white/10" aria-label="Hide chat history">
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
        <div className="panel-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {orderedChats.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-gray-500">Send a message and it will show up here.</p>
          ) : (
            orderedChats.map((chat) => (
              <div key={chat.id} className={`group mb-1 flex items-center rounded-lg ${chat.id === activeId ? "bg-white shadow-sm dark:bg-white/10" : "hover:bg-white/70 dark:hover:bg-white/5"}`}>
                <button type="button" onClick={() => openChat(chat)} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm text-gray-800 dark:text-gray-100">
                  {chat.title || "New chat"}
                </button>
                <button type="button" onClick={() => deleteChat(chat.id)} className="mr-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-error-500 group-hover:flex dark:hover:bg-white/10" aria-label={`Delete ${chat.title}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          aria-pressed={historyOpen}
          aria-label={historyOpen ? "Hide chat history" : "Show chat history"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <ModelMenu models={models} names={names} value={modelId} onChange={setModelId} />
        <button
          type="button"
          onClick={startNewChat}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="panel-scrollbar min-h-0 flex-1 overflow-y-auto pb-20"
      >
        {loadError ? (
          <p className="px-6 py-8 text-sm text-error-500">{loadError}</p>
        ) : models.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
            <p>
              No active models yet.{" "}
              <Link to="/providers" className="font-medium text-brand-600">
                Open a provider
              </Link>{" "}
              and turn a model on.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-lg font-medium text-gray-900 dark:text-white">{selected ? selected.displayName : "Choose a model"}</p>
            <p className="mt-1 text-sm text-gray-500">{selected ? names[selected.providerSlug] || selected.providerSlug : "Turn a model on, then send a message."}</p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                pending={busy && index === messages.length - 1 && !message.text && !message.error && message.media.length === 0}
                onFormat={(format) => patch(message.id, { format })}
              />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4"
      >
        <div className="pointer-events-auto mx-auto w-full max-w-3xl rounded-3xl border border-gray-200 bg-white px-2 py-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {files.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-2 px-1 pt-1">
              {files.map((file) => (
                <button
                  key={file.url}
                  type="button"
                  onClick={() => setFiles((current) => current.filter((item) => item.url !== file.url))}
                  className="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                  title={`Remove ${file.name}`}
                >
                  {file.mime.startsWith("image/") ? (
                    <img src={file.url} alt="" className="h-12 w-12 object-cover" />
                  ) : (
                    <span className="flex h-12 max-w-36 items-center px-2 text-left text-[11px] text-gray-600 dark:text-gray-300">{file.name}</span>
                  )}
                  <span className="absolute right-1 top-1 rounded-full bg-gray-900/70 p-0.5 text-white opacity-0 group-hover:opacity-100">
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="px-2 pb-1">
              <ModalityFlow inputs={selected.inputs} outputs={selected.outputs} />
            </div>
          )}
          <div className="flex items-end gap-1">
            <label className="mb-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" title="Attach">
              <Paperclip className="h-4 w-4" />
              <span className="sr-only">Attach</span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  void onFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              ref={inputRef}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={decisionKind ? "State to decide, or JSON with state and questions" : mediaKind ? "Describe what to generate" : "Message"}
              className="max-h-32 min-h-8 w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-5 text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
            />
            {busy ? (
              <button type="button" onClick={stop} className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900" aria-label="Stop">
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!modelId || (!prompt.trim() && files.length === 0)}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40"
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}

function MessageBubble({ message, pending, onFormat }: { message: ChatMessage; pending: boolean; onFormat: (format: "markdown" | "json") => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-2">
          {message.files.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {message.files.map((file) =>
                file.mime.startsWith("image/") && file.url ? (
                  <img key={file.name + file.url} src={file.url} alt="" className="h-20 w-20 rounded-xl object-cover" />
                ) : (
                  <span key={file.name + file.url} className="rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
                    {file.name}
                  </span>
                ),
              )}
            </div>
          )}
          {message.text && <div className="rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-900 dark:bg-white/10 dark:text-white">{message.text}</div>}
        </div>
      </div>
    );
  }

  const payload = {
    role: "assistant",
    content: message.text,
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.media.length > 0 ? { media: message.media } : {}),
    ...(message.error ? { error: message.error } : {}),
  };

  return (
    <div className="min-w-0">
      <div className="mb-2 inline-flex rounded-lg border border-gray-200 p-0.5 text-xs dark:border-gray-700">
        <button type="button" onClick={() => onFormat("markdown")} className={`rounded-md px-2 py-1 ${message.format === "markdown" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500"}`}>
          Markdown
        </button>
        <button type="button" onClick={() => onFormat("json")} className={`rounded-md px-2 py-1 ${message.format === "json" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500"}`}>
          JSON
        </button>
      </div>
      {message.error ? <p className="text-sm text-error-500">{message.error}</p> : null}
      {message.format === "json" ? (
        <pre className="max-h-[32rem] overflow-auto rounded-xl bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-800 dark:bg-white/5 dark:text-gray-100">{JSON.stringify(message.request ?? payload, null, 2)}</pre>
      ) : (
        <>
          {message.reasoning ? (
            <details className="mb-3 text-sm text-gray-500">
              <summary className="cursor-pointer">Reasoning</summary>
              <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
            </details>
          ) : null}
          <div className="space-y-3">
            {message.media.map((item) =>
              item.type === "video" ? (
                <video key={item.src} src={item.src} controls className="max-h-96 max-w-full rounded-xl" />
              ) : item.type === "audio" ? (
                <audio key={item.src} src={item.src} controls className="w-full" />
              ) : (
                <img key={item.src} src={item.src} alt="" className="max-h-96 max-w-full rounded-xl" />
              ),
            )}
            {message.text ? <MarkdownView text={message.media.length > 0 ? stripMedia(message.text) : message.text} /> : pending ? <p className="text-sm text-gray-400">Thinking…</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

function ModelMenu({ models, names, value, onChange }: { models: Model[]; names: Record<string, string>; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const selected = models.find((model) => model.id === value);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, Model[]>();
    for (const model of models) {
      const provider = names[model.providerSlug] || model.providerSlug;
      const hay = `${provider} ${model.displayName} ${model.upstreamId} ${model.id} ${model.kind}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      const list = map.get(model.providerSlug) ?? [];
      list.push(model);
      map.set(model.providerSlug, list);
    }
    return [...map.entries()].sort((a, b) => (names[a[0]] || a[0]).localeCompare(names[b[0]] || b[0]));
  }, [models, names, query]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="inline-flex h-9 max-w-[min(28rem,70vw)] items-center gap-2 rounded-lg px-2 text-left hover:bg-gray-100 dark:hover:bg-white/5"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{selected?.displayName || "Select a model"}</span>
          {selected ? <span className="block truncate text-[11px] text-gray-500">{names[selected.providerSlug] || selected.providerSlug}</span> : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-40 flex max-h-[min(28rem,70vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="border-b border-gray-200 p-2 dark:border-gray-800">
            <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 dark:bg-white/5">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
                className="h-9 w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
              />
            </label>
          </div>
          <div className="panel-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">No models match that search.</p>
            ) : (
              groups.map(([slug, items]) => (
                <div key={slug}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-3 text-xs font-semibold text-gray-500">
                    <ProviderDot slug={slug} />
                    {names[slug] || slug}
                  </div>
                  {items.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        onChange(model.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5 ${model.id === value ? "text-brand-600" : "text-gray-800 dark:text-gray-100"}`}
                    >
                      <span className="min-w-0 truncate">{model.displayName}</span>
                      {model.kind && model.kind !== "chat" ? <span className="shrink-0 text-[11px] uppercase text-gray-400">{model.kind}</span> : null}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderDot({ slug }: { slug: string }) {
  const icon = providerIcon(slug);
  if (!icon) return <span className="h-4 w-4 rounded bg-gray-200 dark:bg-gray-700" />;
  return <img src={`/providers/${icon.file}.svg`} alt="" className="h-4 w-4 object-contain" />;
}

function mediaInText(text: string): MediaItem[] {
  const found: MediaItem[] = [];
  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const src = match[1];
    if (src.startsWith("http") || src.startsWith("data:image") || src.startsWith("data:video")) {
      found.push({ type: src.includes("video") || src.endsWith(".mp4") || src.endsWith(".webm") ? "video" : "image", src });
    }
  }
  return found;
}

function stripMedia(text: string) {
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
}

function messageContent(prompt: string, files: Attachment[]) {
  const parts: Array<Record<string, unknown>> = [];
  if (prompt) parts.push({ type: "text", text: prompt });
  for (const file of files) {
    if (file.mime.startsWith("image/")) {
      parts.push({ type: "image_url", image_url: { url: file.url } });
      continue;
    }
    if (file.text != null) {
      parts.push({ type: "text", text: `File ${file.name}:\n${file.text}` });
      continue;
    }
    parts.push({ type: "file", file: { filename: file.name, file_data: file.url } });
  }
  return parts;
}

function isTextFile(file: File) {
  if (file.type.startsWith("text/") || file.type.includes("json") || file.type.includes("xml") || file.type.includes("javascript")) {
    return true;
  }
  return /\.(txt|md|json|csv|tsv|xml|yaml|yml|js|ts|tsx|jsx|py|go|rs|java|html|css|sql|log)$/i.test(file.name);
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function decisionRequest(modelId: string, text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { state?: unknown; questions?: unknown };
      if (parsed && typeof parsed === "object" && parsed.questions) {
        return { ...parsed, model: modelId };
      }
    } catch {
      // Plain text is the state.
    }
  }
  return {
    model: modelId,
    state: text,
    questions: {
      decision: {
        type: "noul",
        instructions: "Is the answer yes?",
      },
    },
  };
}

function newId() {
  return crypto.randomUUID();
}

function parseRequest(data: string) {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function chatTitle(messages: ChatMessage[]) {
  const text = messages.find((message) => message.role === "user" && message.text.trim())?.text.trim() ?? "";
  if (!text) return "New chat";
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function forStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    sendContent: typeof message.sendContent === "string" ? message.sendContent : message.text,
    files: message.files.map((file) => ({
      name: file.name,
      mime: file.mime,
      url: file.url.startsWith("data:") ? "" : file.url,
      text: null,
    })),
    media: message.media.filter((item) => item.src.startsWith("http")),
  }));
}
