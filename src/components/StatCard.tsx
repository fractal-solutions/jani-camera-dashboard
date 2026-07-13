import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const ring =
    tone === "good" ? "ring-emerald-400/25"
    : tone === "warn" ? "ring-amber-400/25"
    : tone === "bad" ? "ring-rose-400/30"
    : "ring-[var(--border)]";

  const bg =
    tone === "good" ? "bg-emerald-500/10"
    : tone === "warn" ? "bg-amber-500/10"
    : tone === "bad" ? "bg-rose-500/10"
    : "bg-[var(--surface)]";

  const shadow =
    tone === "good" ? "shadow-emerald-500/10"
    : tone === "warn" ? "shadow-amber-500/10"
    : tone === "bad" ? "shadow-rose-500/10"
    : "shadow-black/25";

  return (
    <div className={`relative overflow-hidden rounded-2xl ${bg} p-5 ring-1 ${ring} shadow-lg ${shadow} backdrop-blur-xl`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-2xl bg-gradient-to-b from-white/[var(--glass-shine)] to-transparent" />
      <div className="relative">
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text)]">{value}</div>
        {sub ? <div className="mt-2 text-sm text-[var(--text-muted)]">{sub}</div> : null}
      </div>
    </div>
  );
}
