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
      className={`bb-btn bb-btn-secondary min-h-11 shrink-0 gap-1 whitespace-nowrap px-4 text-base ${on ? "bb-on" : ""}`}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-bb-label text-bb-cue-gray">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function NumberBox({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-2 text-bb-cue-gray">
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
        className="bb-input h-11 w-20 px-3 font-bb-data text-lg"
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-bb-stage-black/80 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-bb-none border-t border-bb-rule-gray bg-bb-case-charcoal sm:border"
      >
        <div className="flex items-center justify-between border-b border-bb-rule-gray px-4 py-2">
          <h2 id="filter-title" className="text-xl font-bold">
            Filters
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className="h-12 px-3 text-lg text-bb-cue-gray active:text-bb-chart-white">
            Close
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pt-4">
          {fx.keys.length > 0 && (
            <Section title="Key">
              {fx.keys.map(({ value }) => (
                <Chip key={value} on={f.keys.includes(value)} onClick={() => setF({ ...f, keys: toggle(f.keys, value) })}>
                  <span className="font-bb-data">{value}</span>
                </Chip>
              ))}
            </Section>
          )}

          <Section title="Checked">
            <Chip on={f.verified} onClick={() => setF({ ...f, verified: !f.verified })}>
              ✓ Verified only
            </Chip>
          </Section>

          <Section title="Tempo (BPM)">
            {TEMPOS.map((t) => (
              <Chip
                key={t.id}
                on={f.tempos.includes(t.id)}
                onClick={() => setF({ ...f, tempos: toggle<Tempo>(f.tempos, t.id), bpmMin: null, bpmMax: null })}
              >
                {t.label} <span className="text-sm font-normal">{t.hint}</span>
              </Chip>
            ))}
            <div className="mt-1 flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-bb-cue-gray">Custom BPM</span>
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
                <button type="button" onClick={() => setAllTags(true)} className="min-h-11 px-3 text-bb-chart-white underline">
                  All {fx.tags.length} tags…
                </button>
              )}
            </Section>
          )}
        </div>

        <div className="flex gap-3 border-t border-bb-rule-gray p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!countFilters(f)}
            onClick={() => setF(NO_FILTERS)}
            className="bb-btn bb-btn-secondary h-12 px-4 text-lg"
          >
            Clear all
          </button>
          <button type="button" onClick={onClose} className="bb-btn bb-btn-primary h-12 flex-1 text-lg">
            Show {count} {count === 1 ? "song" : "songs"}
          </button>
        </div>
      </div>
    </div>
  );
}
