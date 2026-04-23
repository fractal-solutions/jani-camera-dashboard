import { useEffect, useMemo, useState } from "react";
import "./index.css";
import { api, type Analytics, type Device, type LiveTraffic, type Overview, type PersonRow, type Shop } from "./lib/api";
import { connectWs, type WsEvent } from "./lib/ws";
import { EChart } from "./components/EChart";
import { StatCard } from "./components/StatCard";

type Tab = "overview" | "analytics" | "devices" | "people" | "setup";

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function formatAgo(ts: number | null): string {
  if (!ts) return "—";
  const delta = Math.max(0, nowUnix() - ts);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

function msToHuman(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 ring-1 ring-transparent transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 ring-1 ring-white/10 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
          })
          .catch(() => {});
      }}
      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Card({
  title,
  right,
  children,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-sm shadow-black/20 backdrop-blur">
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-white/75">{title}</div>
          {right ? <div>{right}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const cls =
    tone === "good" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : tone === "warn" ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
    : tone === "bad" ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
    : "border-white/10 bg-white/5 text-white/80";
  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${cls}`}>{children}</span>;
}

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | undefined>(undefined);
  const [devices, setDevices] = useState<Device[]>([]);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [live, setLive] = useState<LiveTraffic | null>(null);
  const [shopOccupancy, setShopOccupancy] = useState<number | null>(null);

  const [analyticsRange, setAnalyticsRange] = useState<"today" | "week" | "month">("today");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  const [selectedSn, setSelectedSn] = useState<string>("");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem("adminToken") ?? "");
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});

  const selectedShop = shops.find(s => s.id === shopId);
  const deviceRows = useMemo(() => devices.filter(d => (shopId ? d.shop_id === shopId : true)), [devices, shopId]);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.shops(), api.devices()])
      .then(([s, d]) => {
        if (!mounted) return;
        setShops(s);
        setDevices(d);
        setShopId(s[0]?.id);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const sn = deviceRows[0]?.sn ?? "";
    setSelectedSn(prev => (prev ? prev : sn));
  }, [deviceRows]);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    const load = async () => {
      const [o, l] = await Promise.all([api.overview(shopId), api.liveTraffic(shopId, 60)]);
      if (cancelled) return;
      setOverview(o);
      setLive(l);
      setShopOccupancy(o.occupancy);
    };
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    api.analytics(analyticsRange, shopId)
      .then(a => {
        if (!cancelled) setAnalytics(a);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [analyticsRange, shopId]);

  useEffect(() => {
    if (!selectedSn) return;
    api.people(selectedSn, 200).then(setPeople).catch(() => setPeople([]));
  }, [selectedSn]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const disconnect = connectWs((evt: WsEvent) => {
      if (evt.event === "occupancy:update") {
        if (evt.data.shopId === shopId) setShopOccupancy(evt.data.shopOccupancy);
      }
      if (evt.event === "flow:update") {
        if (evt.data.occupancy.shop !== null) setShopOccupancy(evt.data.occupancy.shop);
        if (shopId && refreshTimer === null) {
          refreshTimer = window.setTimeout(() => {
            refreshTimer = null;
            Promise.all([api.overview(shopId), api.liveTraffic(shopId, 60)])
              .then(([o, l]) => {
                setOverview(o);
                setLive(l);
              })
              .catch(() => {});
          }, 900);
        }
      }
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      disconnect();
    };
  }, [shopId]);

  const occupancyLimit = selectedShop?.occupancy_limit ?? 50;
  const isOverLimit = (shopOccupancy ?? 0) > occupancyLimit;
  const inactivityMin = selectedShop?.inactivity_minutes_limit ?? 10;
  const hasInactive = deviceRows.some(d => (d.last_seen ? nowUnix() - d.last_seen > inactivityMin * 60 : true));
  const tzOffsetHours = ((selectedShop?.timezone_offset_minutes ?? 180) / 60).toFixed(1);
  const baseUrl = typeof location !== "undefined" ? location.origin : "";

  const chartOption = useMemo(() => {
    const points = live?.points ?? [];
    const x = points.map(p => p.bucket.slice(11, 16));
    const inSeries = points.map(p => p.in_sum);
    const outSeries = points.map(p => p.out_sum);
    return {
      tooltip: { trigger: "axis" },
      legend: { show: false },
      grid: { left: 40, right: 16, top: 18, bottom: 30 },
      xAxis: { type: "category", data: x, boundaryGap: false, axisLabel: { color: "rgba(255,255,255,.55)" } },
      yAxis: {
        type: "value",
        axisLabel: { color: "rgba(255,255,255,.55)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,.08)" } },
      },
      series: [
        { name: "In", type: "line", smooth: true, data: inSeries, symbol: "none", lineStyle: { width: 2 } },
        { name: "Out", type: "line", smooth: true, data: outSeries, symbol: "none", lineStyle: { width: 2 } },
      ],
    } as const;
  }, [live]);

  const genderOption = useMemo(() => {
    const rows = analytics?.demographics.gender ?? [];
    const data = rows.map(r => ({
      name: r.gender === 1 ? "Male" : r.gender === 2 ? "Female" : "Unknown",
      value: r.cnt,
    }));
    return {
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: { borderRadius: 10, borderColor: "rgba(0,0,0,0)", borderWidth: 2 },
          label: { color: "rgba(255,255,255,.75)" },
          data,
        },
      ],
    } as const;
  }, [analytics]);

  const ageOption = useMemo(() => {
    const rows = analytics?.demographics.age ?? [];
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 16, top: 18, bottom: 30 },
      xAxis: { type: "category", data: rows.map(r => r.bucket), axisLabel: { color: "rgba(255,255,255,.55)" } },
      yAxis: {
        type: "value",
        axisLabel: { color: "rgba(255,255,255,.55)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,.08)" } },
      },
      series: [{ type: "bar", data: rows.map(r => r.cnt) }],
    } as const;
  }, [analytics]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-white/55">AI People Counting • HX-CCD21</div>
                <div className="text-xl font-semibold tracking-tight sm:text-2xl">Shop Intelligence</div>
              </div>
              <div className="md:hidden">
                <select
                  value={tab}
                  onChange={e => setTab(e.target.value as Tab)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                >
                  {(["overview", "analytics", "devices", "people", "setup"] as const).map(t => (
                    <option key={t} value={t} className="bg-slate-900">
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <select
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={shopId ?? ""}
                onChange={e => setShopId(Number(e.target.value))}
              >
                {shops.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-900">
                    {s.name}
                  </option>
                ))}
              </select>

              <nav className="hidden rounded-xl border border-white/10 bg-white/5 p-1 text-sm md:flex">
                {(["overview", "analytics", "devices", "people", "setup"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-lg px-3 py-2 capitalize transition ${tab === t ? "bg-white/15" : "hover:bg-white/10"}`}
                  >
                    {t}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isOverLimit ? "bad" : "neutral"}>Occupancy: {shopOccupancy ?? "—"}</Badge>
          <Badge tone={hasInactive ? "warn" : "neutral"}>Inactivity threshold: {inactivityMin}m</Badge>
          <Badge tone="neutral">Timezone: UTC{Number(tzOffsetHours) >= 0 ? "+" : ""}{tzOffsetHours}</Badge>
        </div>

        {isOverLimit ? (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm">
            Alert: occupancy ({shopOccupancy ?? 0}) exceeds limit ({occupancyLimit}).
          </div>
        ) : null}
        {hasInactive ? (
          <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            Alert: one or more devices have no activity for &gt; {inactivityMin} minutes.
          </div>
        ) : null}

        {tab === "overview" ? (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Current occupancy"
                value={<span className={isOverLimit ? "text-rose-200" : "text-white"}>{shopOccupancy ?? "—"}</span>}
                tone={isOverLimit ? "bad" : "neutral"}
              />
              <StatCard label="Visitors today" value={overview?.visitors ?? "—"} sub={`Conversion proxy: ${(overview && overview.passby ? Math.round((overview.visitors / overview.passby) * 100) : 0) || 0}%`} />
              <StatCard label="Avg dwell time" value={msToHuman(overview?.avgDwellMs ?? null)} sub={`Return visitors (camera): ${overview?.returnVisitors ?? 0}`} />
              <StatCard label="Peak occupancy (today)" value={overview?.peakOccupancy ?? "—"} sub={`Last refresh: ${formatAgo(overview?.now ?? null)}`} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card
                title={`Live traffic (last ${live?.minutes ?? 60} min)`}
                right={<GhostButton onClick={() => shopId && api.liveTraffic(shopId, 60).then(setLive).catch(() => {})}>Refresh</GhostButton>}
              >
                <EChart option={chartOption} className="h-72 w-full" />
              </Card>

              <Card title="Device status">
                <div className="space-y-3">
                  {deviceRows.slice(0, 6).map(d => (
                    <div key={d.sn} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{d.name}</div>
                        <div className="truncate font-mono text-xs text-white/55">{d.sn}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-semibold ${d.status === "online" ? "text-emerald-300" : "text-white/70"}`}>{d.status}</div>
                        <div className="text-xs text-white/50">{formatAgo(d.last_seen)}</div>
                      </div>
                    </div>
                  ))}
                  {deviceRows.length === 0 ? <div className="text-sm text-white/60">No devices for this shop.</div> : null}
                </div>
              </Card>
            </div>
          </>
        ) : null}

        {tab === "analytics" ? (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card
              title="Traffic trend"
              right={
                <div className="flex items-center gap-2">
                  {(["today", "week", "month"] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setAnalyticsRange(r)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        analyticsRange === r ? "border-white/20 bg-white/15" : "border-white/10 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              }
            >
              <EChart
                option={{
                  tooltip: { trigger: "axis" },
                  grid: { left: 40, right: 16, top: 18, bottom: 30 },
                  xAxis: {
                    type: "category",
                    data: analytics?.traffic.points.map(p => p.bucket.slice(0, 10)) ?? [],
                    axisLabel: { color: "rgba(255,255,255,.55)" },
                  },
                  yAxis: {
                    type: "value",
                    axisLabel: { color: "rgba(255,255,255,.55)" },
                    splitLine: { lineStyle: { color: "rgba(255,255,255,.08)" } },
                  },
                  series: [
                    { name: "In", type: "line", smooth: true, symbol: "none", data: analytics?.traffic.points.map(p => p.in_sum) ?? [] },
                    { name: "Out", type: "line", smooth: true, symbol: "none", data: analytics?.traffic.points.map(p => p.out_sum) ?? [] },
                    { name: "Passby", type: "line", smooth: true, symbol: "none", data: analytics?.traffic.points.map(p => p.pass_sum) ?? [] },
                  ],
                }}
                className="h-80 w-full"
              />
            </Card>

            <Card title="Gender distribution">
              <EChart option={genderOption} className="h-72 w-full" />
            </Card>

            <Card title="Age distribution">
              <EChart option={ageOption} className="h-72 w-full" />
            </Card>
          </div>
        ) : null}

        {tab === "devices" ? (
          <div className="mt-6">
            <Card title="Device monitoring" right={<GhostButton onClick={() => api.devices().then(setDevices).catch(() => {})}>Refresh</GhostButton>}>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="text-xs text-white/55">
                    <tr>
                      <th className="py-2">Name</th>
                      <th className="py-2">SN</th>
                      <th className="py-2">Shop</th>
                      <th className="py-2">Mode</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Last seen</th>
                      <th className="py-2">IP</th>
                      <th className="py-2">MAC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {deviceRows.map(d => (
                      <tr key={d.sn} className="hover:bg-white/5">
                        <td className="py-3 pr-3 font-semibold">{d.name}</td>
                        <td className="py-3 pr-3 font-mono text-xs text-white/70">{d.sn}</td>
                        <td className="py-3 pr-3">{d.shop_name ?? "—"}</td>
                        <td className="py-3 pr-3">{d.data_mode}</td>
                        <td className={`py-3 pr-3 font-semibold ${d.status === "online" ? "text-emerald-300" : "text-white/70"}`}>{d.status}</td>
                        <td className="py-3 pr-3">{formatAgo(d.last_seen)}</td>
                        <td className="py-3 pr-3 font-mono text-xs text-white/70">{d.ip_address ?? "—"}</td>
                        <td className="py-3 pr-3 font-mono text-xs text-white/70">{d.mac_address ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-3 md:hidden">
                {deviceRows.map(d => (
                  <div key={d.sn} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{d.name}</div>
                        <div className="mt-1 truncate font-mono text-xs text-white/60">{d.sn}</div>
                        <div className="mt-2 text-xs text-white/60">{d.shop_name ?? "—"}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-semibold ${d.status === "online" ? "text-emerald-300" : "text-white/70"}`}>{d.status}</div>
                        <div className="mt-1 text-xs text-white/50">{formatAgo(d.last_seen)}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/60">
                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                        <div className="text-white/40">Mode</div>
                        <div className="mt-1 text-white/80">{d.data_mode}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                        <div className="text-white/40">IP</div>
                        <div className="mt-1 font-mono text-white/80">{d.ip_address ?? "—"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "people" ? (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="People settings">
              <div className="text-sm text-white/70">Admin token (for labeling)</div>
              <input
                value={adminToken}
                onChange={e => {
                  setAdminToken(e.target.value);
                  localStorage.setItem("adminToken", e.target.value);
                }}
                placeholder="Set ADMIN_TOKEN in .env, paste it here"
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
              />

              <div className="mt-4 text-sm text-white/70">Select camera</div>
              <select
                value={selectedSn}
                onChange={e => setSelectedSn(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                {deviceRows.map(d => (
                  <option key={d.sn} value={d.sn} className="bg-slate-900">
                    {d.name} ({d.sn})
                  </option>
                ))}
              </select>

              <div className="mt-4 flex gap-2">
                <GhostButton onClick={() => selectedSn && api.people(selectedSn, 200).then(setPeople).catch(() => setPeople([]))} disabled={!selectedSn}>
                  Refresh
                </GhostButton>
                <PrimaryButton onClick={() => selectedSn && api.people(selectedSn, 200).then(setPeople).catch(() => setPeople([]))} disabled={!selectedSn}>
                  Load
                </PrimaryButton>
              </div>

              <div className="mt-4 text-xs text-white/50">
                Labeling works only if the camera sends stable <span className="font-mono">attributes.personId</span> values.
              </div>
            </Card>

            <div className="lg:col-span-2">
              <Card title="Recent people (from attributes.personId)">
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[940px] text-left text-sm">
                    <thead className="text-xs text-white/55">
                      <tr>
                        <th className="py-2">Person ID</th>
                        <th className="py-2">Label</th>
                        <th className="py-2">Last seen</th>
                        <th className="py-2">Enter</th>
                        <th className="py-2">Leave</th>
                        <th className="py-2">Return</th>
                        <th className="py-2">Pass</th>
                        <th className="py-2">Gender</th>
                        <th className="py-2">Age</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {people.map(p => {
                        const edit = labelEdits[p.person_id];
                        const current = edit ?? p.label ?? "";
                        return (
                          <tr key={p.person_id} className="hover:bg-white/5">
                            <td className="py-3 pr-3 font-mono text-xs text-white/70">{p.person_id}</td>
                            <td className="py-3 pr-3">
                              <input
                                value={current}
                                onChange={e => setLabelEdits(prev => ({ ...prev, [p.person_id]: e.target.value }))}
                                className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm outline-none focus:border-white/20"
                                placeholder="e.g. Staff - John"
                              />
                            </td>
                            <td className="py-3 pr-3">{formatAgo(p.last_seen)}</td>
                            <td className="py-3 pr-3">{p.enters}</td>
                            <td className="py-3 pr-3">{p.leaves}</td>
                            <td className="py-3 pr-3">{p.returns}</td>
                            <td className="py-3 pr-3">{p.pass}</td>
                            <td className="py-3 pr-3">{p.gender === 1 ? "M" : p.gender === 2 ? "F" : "—"}</td>
                            <td className="py-3 pr-3">{p.age_min && p.age_max ? `${p.age_min}-${p.age_max}` : "—"}</td>
                            <td className="py-3 pr-3">
                              <PrimaryButton
                                disabled={!adminToken || !selectedSn}
                                onClick={() => {
                                  if (!adminToken || !selectedSn) return;
                                  api
                                    .labelPerson(adminToken, selectedSn, p.person_id, current)
                                    .then(() => api.people(selectedSn, 200).then(setPeople))
                                    .catch(() => {});
                                }}
                              >
                                Save
                              </PrimaryButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 gap-3 md:hidden">
                  {people.map(p => {
                    const edit = labelEdits[p.person_id];
                    const current = edit ?? p.label ?? "";
                    return (
                      <div key={p.person_id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-white/50">Person ID</div>
                            <div className="mt-1 truncate font-mono text-xs text-white/80">{p.person_id}</div>
                          </div>
                          <div className="text-right text-xs text-white/50">{formatAgo(p.last_seen)}</div>
                        </div>
                        <div className="mt-3">
                          <div className="text-xs text-white/50">Label</div>
                          <input
                            value={current}
                            onChange={e => setLabelEdits(prev => ({ ...prev, [p.person_id]: e.target.value }))}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
                            placeholder="e.g. Staff - John"
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                          <div className="rounded-xl border border-white/10 bg-white/5 py-2">
                            <div className="text-white/50">Enter</div>
                            <div className="mt-1 font-semibold">{p.enters}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/5 py-2">
                            <div className="text-white/50">Leave</div>
                            <div className="mt-1 font-semibold">{p.leaves}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/5 py-2">
                            <div className="text-white/50">Return</div>
                            <div className="mt-1 font-semibold">{p.returns}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/5 py-2">
                            <div className="text-white/50">Pass</div>
                            <div className="mt-1 font-semibold">{p.pass}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <PrimaryButton
                            disabled={!adminToken || !selectedSn}
                            onClick={() => {
                              if (!adminToken || !selectedSn) return;
                              api
                                .labelPerson(adminToken, selectedSn, p.person_id, current)
                                .then(() => api.people(selectedSn, 200).then(setPeople))
                                .catch(() => {});
                            }}
                          >
                            Save label
                          </PrimaryButton>
                        </div>
                      </div>
                    );
                  })}
                  {people.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-white/60">
                      No people yet. Enable attribute uploads on the camera so <span className="font-mono">attributes.personId</span> is included.
                    </div>
                  ) : null}
                </div>

                {people.length === 0 ? (
                  <div className="mt-3 hidden rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white/60 md:block">
                    No people yet. Enable attribute uploads on the camera so <span className="font-mono">attributes.personId</span> is included.
                  </div>
                ) : null}
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "setup" ? (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Camera server URLs (paste into camera UI)">
              <div className="space-y-3 text-sm">
                {[
                  { label: "Heartbeat", url: `${baseUrl}/api/camera/heartBeat` },
                  { label: "Data upload", url: `${baseUrl}/api/camera/dataUpload` },
                  { label: "Duplicate report (optional, daily)", url: `${baseUrl}/dup` },
                  { label: "REID report (optional, daily)", url: `${baseUrl}/reid` },
                ].map(row => (
                  <div key={row.label} className="rounded-xl border border-white/10 bg-black/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-white/60">{row.label}</div>
                      <CopyButton text={row.url} />
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-white/80">{row.url}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs text-white/50">
                Use your PC’s LAN IP or public domain in the camera UI (don’t use <span className="font-mono">localhost</span> from the camera).
              </div>
            </Card>

            <Card title="Setup checklist">
              <ol className="list-decimal space-y-2 pl-4 text-sm text-white/75">
                <li>
                  Point the camera “server address / push URL” to this server (heartbeat + data upload).
                </li>
                <li>
                  Register the camera SN in the dashboard (so it isn’t rejected).
                </li>
                <li>
                  Enable attribute upload if you want <span className="font-mono">personId</span> + demographics.
                </li>
                <li>
                  If supported by firmware (PDF v2.4), enable daily <span className="font-mono">dup</span> and <span className="font-mono">reid</span> uploads.
                </li>
              </ol>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-xs text-white/60">
                WebSocket status updates: <span className="font-mono">/ws</span> • API: <span className="font-mono">/api/*</span>
              </div>
            </Card>
          </div>
        ) : null}

        <div className="mt-8 text-xs text-white/45">
          API: <span className="font-mono">/api/camera/heartBeat</span>, <span className="font-mono">/api/camera/dataUpload</span> • WS:{" "}
          <span className="font-mono">/ws</span>
        </div>
      </div>
    </div>
  );
}

export default App;
