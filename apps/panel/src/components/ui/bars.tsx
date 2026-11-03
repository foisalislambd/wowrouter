export function Bars({
  points,
}: {
  points: { key: string; label: string; value: number; title: string }[];
}) {
  const peak = Math.max(...points.map((item) => item.value), 1);
  if (points.length === 0) return null;
  return (
    <div className="panel-card panel-card-body">
      <div className="flex h-28 items-end gap-1" role="img" aria-label="Requests by day">
        {points.map((point) => (
          <div key={point.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={point.title}>
            <div className="rounded-sm bg-brand-500/80" style={{ height: `${Math.max(4, (point.value / peak) * 100)}%` }} />
            <span className="mt-1 truncate text-center text-[10px] text-gray-400">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
