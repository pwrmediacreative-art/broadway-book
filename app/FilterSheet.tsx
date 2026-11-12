"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { countFilters, NO_FILTERS, TEMPOS, type Facets, type Filters, type Tempo } from "@/lib/search/browse";

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-4 text-base font-semibold ${
        on ? "border-accent bg-accent text-black" : "border-line bg-panel text-foreground active:bg-line"
      }`}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function NumberBox({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-2 text-muted">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={20}
        max={400}
        value={value ?? ""}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n > 0 && n < 1000 ? n : null);
        }}
        className="h-11 w-20 rounded-lg border border-line bg-background px-3 text-lg text-foreground focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/** Filter panel: bottom sheet on phones, centered panel on wide screens. Changes apply live. */
export default function FilterSheet({
  open,
  onClose,
  f,
  setF,
  fx,
  count,
}: {
  open: boolean;
  onClose: () => void;
  f: Filters;
  setF: (f: Filters) => void;
  fx: Facets;
  count: number;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [allTags, setAllTags] = useState(false);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const tags = allTags ? fx.tags : fx.tags.slice(0, 24);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-panel sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <h2 id="filter-title" className="text-xl font-bold">
            Filters
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className="h-12 px-3 text-lg text-muted active:text-foreground">
            Close
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pt-4">
          {fx.keys.length > 0 && (
            <Section title="Key">
              {fx.keys.map(({ value }) => (
                <Chip key={value} on={f.keys.includes(value)} onClick={() => setF({ ...f, keys: toggle(f.keys, value) })}>
                  <span className="font-mono">{value}</span>
                </Chip>
              ))}
            </Section>
          )}

          <Section title="Tempo (BPM)">
            {TEMPOS.map((t) => (
              <Chip
                key={t.id}
                on={f.tempos.includes(t.id)}
                onClick={() => setF({ ...f, tempos: toggle<Tempo>(f.tempos, t.id), bpmMin: null, bpmMax: null })}
              >
                {t.label} <span className="text-sm font-normal opacity-80">{t.hint}</span>
              </Chip>
            ))}
            <div className="mt-1 flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-muted">Custom BPM</span>
              <NumberBox label="from" value={f.bpmMin} onChange={(v) => setF({ ...f, tempos: [], bpmMin: v })} />
              <NumberBox label="to" value={f.bpmMax} onChange={(v) => setF({ ...f, tempos: [], bpmMax: v })} />
            </div>
          </Section>

          {fx.times.length > 0 && (
            <Section title="Time signature">
              {fx.times.map(({ value }) => (
                <Chip key={value} on={f.times.includes(value)} onClick={() => setF({ ...f, times: toggle(f.times, value) })}>
                  {value}
                </Chip>
              ))}
            </Section>
          )}

          {fx.feels.length > 0 && (
            <Section title="Feel">
              {fx.feels.map(({ value }) => (
                <Chip key={value} on={f.feels.includes(value)} onClick={() => setF({ ...f, feels: toggle(f.feels, value) })}>
                  {cap(value)}
                </Chip>
              ))}
            </Section>
          )}

          {fx.tags.length > 0 && (
            <Section title="Tags">
              {tags.map(({ value }) => (
                <Chip key={value} on={f.tags.includes(value)} onClick={() => setF({ ...f, tags: toggle(f.tags, value) })}>
                  {value}
                </Chip>
              ))}
              {fx.tags.length > tags.length && (
                <button type="button" onClick={() => setAllTags(true)} className="min-h-11 px-3 text-accent">
                  All {fx.tags.length} tags…
                </button>
              )}
            </Section>
          )}
        </div>

        <div className="flex gap-3 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!countFilters(f)}
            onClick={() => setF(NO_FILTERS)}
            className="h-12 rounded-xl border border-line px-4 text-lg font-semibold disabled:opacity-40"
          >
            Clear all
          </button>
          <button type="button" onClick={onClose} className="h-12 flex-1 rounded-xl bg-accent text-lg font-bold text-black active:opacity-80">
            Show {count} {count === 1 ? "song" : "songs"}
          </button>
        </div>
      </div>
    </div>
  );
}
