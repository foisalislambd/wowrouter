import { useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createContext } from "react";
import { createPortal } from "react-dom";

type Tone = "ok" | "err";
type Toast = { id: number; text: string; tone: Tone };

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  function push(text: string, tone: Tone = "ok") {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 2800);
  }
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-lg ${
              toast.tone === "err"
                ? "border-error-200 bg-error-50 text-error-500 dark:border-error-500/40 dark:bg-gray-900"
                : "border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="panel-card w-full max-w-md p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-200">
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg bg-error-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DangerButton({
  label,
  title,
  body,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <button type="button" className="text-sm font-medium text-error-500 hover:underline" onClick={() => setOpen(true)}>
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        body={body}
        confirmLabel={label}
        busy={busy}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          setBusy(true);
          onConfirm()
            .then(() => {
              toast("Removed");
              setOpen(false);
            })
            .catch((err: Error) => toast(err.message || "Could not remove", "err"))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="panel-card panel-card-body">
      <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
      <p className="mt-1 max-w-xl text-sm text-gray-500">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return <p className="text-sm text-gray-500" role="status">{label}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mb-3 text-sm text-error-500" role="alert">{children}</p>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          toast("Copied");
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => toast("Could not copy", "err"));
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
