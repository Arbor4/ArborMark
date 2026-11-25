import type { ReactNode } from "react";
import { useUi } from "@/stores/ui";
import { Switch } from "../common";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[12.5px] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>}
      </div>
      {control}
    </div>
  );
}

/** 偏好开关：读取 prefs[k]（默认 def），写入并持久化。 */
export function usePrefBool(k: string, def = true): [boolean, (v: boolean) => void] {
  const prefs = useUi((s) => s.prefs);
  const setPref = useUi((s) => s.setPref);
  const v = prefs[k];
  const value = v === undefined ? def : v !== false && v !== "false";
  return [value, (nv) => setPref(k, nv)];
}

export function PrefSwitch({
  k,
  label,
  hint,
  def = true,
}: {
  k: string;
  label: string;
  hint?: string;
  def?: boolean;
}) {
  const [value, setValue] = usePrefBool(k, def);
  return <Row label={label} hint={hint} control={<Switch checked={value} label={label} onChange={setValue} />} />;
}

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="rounded-md border border-line bg-field px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
