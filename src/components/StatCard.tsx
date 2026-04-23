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
    tone === "good" ? "ring-emerald-400/20"
    : tone === "warn" ? "ring-amber-400/20"
    : tone === "bad" ? "ring-rose-400/25"
    : "ring-white/10";

  const bg =
    tone === "good" ? "bg-emerald-500/10"
    : tone === "warn" ? "bg-amber-500/10"
    : tone === "bad" ? "bg-rose-500/10"
    : "bg-white/5";

  return (
    <div className={`rounded-2xl ${bg} p-5 ring-1 ${ring} backdrop-blur`}>
      <div className="text-xs font-medium uppercase tracking-wide text-white/55">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-2 text-sm text-white/60">{sub}</div> : null}
    </div>
  );
}
