'use client';

import { useEffect, useRef, useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/form';
import { Popover } from '@/components/ui/overlay';
import { EmptyPill } from '@/components/ui/states';
import { cn } from '@/lib/cn';

import { columnGroups, columnOf, isStandard, moveColumn, toggleColumn } from '../columns';
import { useLogs } from '../store';

/**
 * Which columns the table shows and in what order: a checkbox per column and arrows to move a
 * shown one. Beside the log's own columns it offers every field of the record the gateway's
 * schema describes, grouped. The choice is the user's own and follows them (preferences); views
 * keep one too.
 */
export function ColumnChooser({
  columns,
  onChange,
}: {
  columns: string[];
  /** The new choice; null for the standard set. */
  onChange: (columns: string[] | null) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const fields = useLogs((s) => s.fields);
  const loadFields = useLogs((s) => s.loadFields);
  useEffect(() => {
    if (open) void loadFields();
  }, [open, loadFields]);
  const needle = find.trim().toLowerCase();
  const groups = columnGroups(fields.data?.map((f) => f.name) ?? null)
    .map((g) => ({
      title: g.title,
      columns: g.columns.filter(
        (c) =>
          !columns.includes(c.id) &&
          (!needle || c.label.toLowerCase().includes(needle) || (c.field ?? '').includes(needle)),
      ),
    }))
    .filter((g) => g.columns.length > 0);
  const anyHidden = columnGroups(fields.data?.map((f) => f.name) ?? null).some((g) =>
    g.columns.some((c) => !columns.includes(c.id)),
  );
  const set = (next: string[]) => onChange(isStandard(next) ? null : next);
  return (
    <>
      <Button
        ref={anchor}
        icon="columns"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <span className="max-md:sr-only">Columns</span>
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="right"
        label="Columns"
        className="w-[280px]"
      >
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-ui font-semibold text-fg">Columns</span>
          <button
            type="button"
            disabled={isStandard(columns)}
            onClick={() => onChange(null)}
            className="rounded-xs text-caption text-muted hover:text-fg disabled:invisible"
          >
            Reset
          </button>
        </div>
        <ul aria-label="Shown columns" className="flex flex-col p-1">
          {columns.map((id, i) => {
            const c = columnOf(id);
            if (!c) return null;
            return (
              <li key={id} className="flex min-h-8 items-center gap-1 rounded-sm px-2 py-1 hover:bg-hover">
                <Checkbox
                  className="min-w-0 flex-1"
                  checked
                  disabled={c.fixed}
                  onChange={() => set(toggleColumn(columns, id))}
                  label={
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{c.label}</span>
                      {c.note ? <span className="text-caption text-dim">{c.note}</span> : null}
                    </span>
                  }
                />
                <IconButton
                  icon="arrowUp"
                  size={14}
                  label={`Move ${c.label} up`}
                  disabled={i === 0}
                  className={cn(i === 0 && 'invisible')}
                  onClick={() => set(moveColumn(columns, id, -1))}
                />
                <IconButton
                  icon="arrowDown"
                  size={14}
                  label={`Move ${c.label} down`}
                  disabled={i === columns.length - 1}
                  className={cn(i === columns.length - 1 && 'invisible')}
                  onClick={() => set(moveColumn(columns, id, 1))}
                />
              </li>
            );
          })}
        </ul>
        {anyHidden ? (
          <div className="border-t border-line">
            <div className="flex flex-col gap-1.5 px-3 pt-2 pb-1">
              <span className="text-caption text-muted">Hidden</span>
              <Input
                aria-label="Find a column"
                icon="search"
                placeholder="Find a column"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                className="h-7 text-caption"
              />
            </div>
            {groups.map((g) => (
              <ul key={g.title} aria-label={`Hidden columns: ${g.title}`} className="flex flex-col p-1 pt-0">
                <li aria-hidden="true" className="px-2 pt-2 pb-1 text-caption font-medium text-dim">
                  {g.title}
                </li>
                {g.columns.map((c) => (
                  <li key={c.id} className="flex h-8 items-center rounded-sm px-2 hover:bg-hover">
                    <Checkbox
                      className="min-w-0 flex-1"
                      checked={false}
                      onChange={() => set(toggleColumn(columns, c.id))}
                      label={<span className="truncate">{c.label}</span>}
                    />
                  </li>
                ))}
              </ul>
            ))}
            {groups.length === 0 ? (
              <div className="flex justify-center px-3 py-3">
                <EmptyPill>No column matches</EmptyPill>
              </div>
            ) : null}
            {fields.error && !fields.data ? (
              <p className="px-3 pb-2 text-caption text-dim">
                The record&apos;s other fields couldn&apos;t be read from the gateway.
              </p>
            ) : null}
          </div>
        ) : null}
      </Popover>
    </>
  );
}
