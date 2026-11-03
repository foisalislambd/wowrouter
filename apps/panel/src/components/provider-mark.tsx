import { providerIcon } from "@/lib/provider-icons";

export function ProviderMark({ slug, name }: { slug: string; name: string }) {
  const icon = providerIcon(slug);
  const letters = name.slice(0, 2).toUpperCase();
  if (!icon) {
    return (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-sm font-semibold text-white dark:bg-white dark:text-gray-900">
        {letters}
      </span>
    );
  }
  return (
    <span
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 ${
        icon.white ? "bg-gray-900" : "bg-white dark:bg-gray-900"
      }`}
    >
      <img src={`/providers/${icon.file}.svg`} alt="" className="h-7 w-7 object-contain" />
    </span>
  );
}
