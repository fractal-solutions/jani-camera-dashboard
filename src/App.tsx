import { useEffect, useMemo, useState } from "react";
import "./index.css";
import { api, type Analytics, type Device, type LiveTraffic, type Overview, type Shop } from "./lib/api";
import { connectWs, type WsEvent } from "./lib/ws";
import { EChart } from "./components/EChart";
import { StatCard } from "./components/StatCard";

type Tab = "overview" | "analytics" | "devices";

function formatAgo(ts: number | null): string {
  if (!ts) return "—";
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - ts);
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

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | undefined>(undefined);
  const [devices, setDevices] = useState<Device[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [live, setLive] = useState<LiveTraffic | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<"today" | "week" | "month">("today");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [shopOccupancy, setShopOccupancy] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.shops(), api.devices()])
      .then(([s, d]) => {
        if (!mounted) return;
        setShops(s);
        setDevices(d);
        const first = s[0]?.id;
        setShopId(first);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

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
    let refreshTimer: number | null = null;
    const disconnect = connectWs((evt: WsEvent) => {
      if (evt.event === "occupancy:update") {
        if (evt.data.shopId === shopId) setShopOccupancy(evt.data.shopOccupancy);
      }
      if (evt.event === "flow:update") {
        // lightweight refresh: re-fetch overview + live traffic soon
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
          }, 1200);
        }
      }
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      disconnect();
    };
  }, [shopId]);

  const selectedShop = shops.find(s => s.id === shopId);
  const deviceRows = useMemo(() => devices.filter(d => (shopId ? d.shop_id === shopId : true)), [devices, shopId]);

  const chartOption = useMemo(() => {
    const points = live?.points ?? [];
    const x = points.map(p => p.bucket.slice(11, 16));
    const inSeries = points.map(p => p.in_sum);
    const outSeries = points.map(p => p.out_sum);
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      xAxis: { type: "category", data: x, boundaryGap: false, axisLabel: { color: "rgba(255,255,255,.6)" } },
      yAxis: { type: "value", axisLabel: { color: "rgba(255,255,255,.6)" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.08)" } } },
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
          radius: ["45%", "70%"],
          itemStyle: { borderRadius: 8, borderColor: "rgba(0,0,0,0)", borderWidth: 2 },
          label: { color: "rgba(255,255,255,.7)" },
          data,
        },
      ],
    } as const;
  }, [analytics]);

  const ageOption = useMemo(() => {
    const rows = analytics?.demographics.age ?? [];
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      xAxis: { type: "category", data: rows.map(r => r.bucket), axisLabel: { color: "rgba(255,255,255,.6)" } },
      yAxis: { type: "value", axisLabel: { color: "rgba(255,255,255,.6)" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.08)" } } },
      series: [{ type: "bar", data: rows.map(r => r.cnt) }],
    } as const;
  }, [analytics]);

  const occupancyLimit = selectedShop?.occupancy_limit ?? 50;
  const isOverLimit = (shopOccupancy ?? 0) > occupancyLimit;
  const inactivityMin = selectedShop?.inactivity_minutes_limit ?? 10;
  const hasInactive = deviceRows.some(d => (d.last_seen ? Math.floor(Date.now() / 1000) - d.last_seen > inactivityMin * 60 : true));

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs text-white/60">AI People Counting • HX-CCD21</div>
            <div className="text-2xl font-semibold tracking-tight">Shop Intelligence Dashboard</div>
          </div>
          <div className="flex items-center gap-2">
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
            <nav className="flex rounded-xl border border-white/10 bg-white/5 p-1 text-sm">
              {(["overview", "analytics", "devices"] as const).map(t => (
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

        {isOverLimit ? (
          <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm">
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
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <StatCard label="Current occupancy" value={<span className={isOverLimit ? "text-rose-300" : ""}>{shopOccupancy ?? "—"}</span>} />
              <StatCard label="Visitors today" value={overview?.visitors ?? "—"} sub={`Conversion proxy: ${(overview && overview.passby ? Math.round((overview.visitors / overview.passby) * 100) : 0) || 0}%`} />
              <StatCard label="Avg dwell time" value={msToHuman(overview?.avgDwellMs ?? null)} sub={`Return rate proxy: ${(overview && overview.passby ? Math.round((overview.turnback / overview.passby) * 100) : 0) || 0}%`} />
              <StatCard label="Peak net/min (today)" value={overview?.peakNetPerMinute ?? "—"} sub={`Last refresh: ${formatAgo(overview?.now ?? null)}`} />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm text-white/70">Live traffic (last {live?.minutes ?? 60} min)</div>
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                    onClick={() => shopId && api.liveTraffic(shopId, 60).then(setLive).catch(() => {})}
                  >
                    Refresh
                  </button>
                </div>
                <EChart option={chartOption} className="h-72 w-full" />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="text-sm text-white/70">Device status</div>
                <div className="mt-4 space-y-3">
                  {deviceRows.slice(0, 6).map(d => (
                    <div key={d.sn} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm">{d.name}</div>
                        <div className="truncate text-xs text-white/60">{d.sn}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs ${d.status === "online" ? "text-emerald-300" : "text-white/60"}`}>{d.status}</div>
                        <div className="text-xs text-white/50">{formatAgo(d.last_seen)}</div>
                      </div>
                    </div>
                  ))}
                  {deviceRows.length === 0 ? <div className="text-sm text-white/60">No devices for this shop.</div> : null}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === "analytics" ? (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-white/70">Traffic trend</div>
                <div className="flex items-center gap-2">
                  {(["today", "week", "month"] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setAnalyticsRange(r)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${analyticsRange === r ? "border-white/20 bg-white/15" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <EChart
                option={{
                  tooltip: { trigger: "axis" },
                  grid: { left: 40, right: 20, top: 20, bottom: 30 },
                  xAxis: {
                    type: "category",
                    data: analytics?.traffic.points.map(p => p.bucket.slice(0, 10)) ?? [],
                    axisLabel: { color: "rgba(255,255,255,.6)" },
                  },
                  yAxis: {
                    type: "value",
                    axisLabel: { color: "rgba(255,255,255,.6)" },
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
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm text-white/70">Gender distribution</div>
              <EChart option={genderOption} className="h-72 w-full" />
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:col-span-3">
              <div className="text-sm text-white/70">Age distribution</div>
              <EChart option={ageOption} className="h-72 w-full" />
            </div>
          </div>
        ) : null}

        {tab === "devices" ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-white/70">Device monitoring</div>
              <button
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                onClick={() => api.devices().then(setDevices).catch(() => {})}
              >
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-xs text-white/60">
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
                      <td className="py-3 pr-3">{d.name}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-white/70">{d.sn}</td>
                      <td className="py-3 pr-3">{d.shop_name ?? "—"}</td>
                      <td className="py-3 pr-3">{d.data_mode}</td>
                      <td className={`py-3 pr-3 ${d.status === "online" ? "text-emerald-300" : "text-white/70"}`}>{d.status}</td>
                      <td className="py-3 pr-3">{formatAgo(d.last_seen)}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-white/70">{d.ip_address ?? "—"}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-white/70">{d.mac_address ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
