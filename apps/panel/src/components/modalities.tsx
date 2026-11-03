import { AudioLines, Braces, Circle, FileText, Image, Scale, Type, Video, type LucideIcon } from "lucide-react";

const modalityMeta: Record<string, { icon: LucideIcon; label: string }> = {
  text: { icon: Type, label: "Text" },
  file: { icon: FileText, label: "File" },
  image: { icon: Image, label: "Image" },
  audio: { icon: AudioLines, label: "Audio" },
  video: { icon: Video, label: "Video" },
  embedding: { icon: Braces, label: "Embedding" },
  decisions: { icon: Scale, label: "Decisions" },
};

function entries(value: string) {
  const names = (value || "text")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.map((name) => {
    const known = modalityMeta[name];
    if (known) return { name, ...known };
    return { name, icon: Circle, label: name.charAt(0).toUpperCase() + name.slice(1) };
  });
}

function ModalityList({ value }: { value: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entries(value).map((item) => {
        const Icon = item.icon;
        return (
          <span key={item.name} title={item.label} className="inline-flex text-gray-500 dark:text-gray-300">
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{item.label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ModalityFlow({ inputs, outputs }: { inputs: string; outputs: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-300">
      <ModalityList value={inputs} />
      <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">
        →
      </span>
      <ModalityList value={outputs} />
    </div>
  );
}
