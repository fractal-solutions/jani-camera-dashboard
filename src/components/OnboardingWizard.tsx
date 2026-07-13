import { useEffect, useState } from "react";
import { api, type Device } from "../lib/api";

type CameraEntry = { sn: string; name: string; mode: "Add" | "Total" };

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function formatAgo(ts: number | null): string {
  if (!ts) return "never";
  const delta = Math.max(0, nowUnix() - ts);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
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
      className="inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] ring-1 ring-transparent backdrop-blur-sm transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
      className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: `linear-gradient(to bottom, var(--accent-hover), var(--accent))`, boxShadow: `0 10px 15px -3px var(--accent-glow)` }}
    >
      {children}
    </button>
  );
}

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition ${
              i < current
                ? "bg-emerald-500 text-white"
                : i === current
                  ? "text-white"
                  : "text-[var(--text-muted)]"
            }`}
            style={i === current ? { background: `var(--accent)` } : i >= current ? { background: `var(--surface-hover)` } : undefined}
          >
            {i < current ? "✓" : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-px w-6 ${i < current ? "bg-emerald-500/50" : "bg-[var(--border)]"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function OnboardingWizard({
  adminToken,
  onComplete,
  onClose,
}: {
  adminToken: string;
  onComplete: (shopId?: number) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  // Step 1: shop details
  const [shopName, setShopName] = useState("");
  const [tzOffset, setTzOffset] = useState<number | "">(180);
  const [occLimit, setOccLimit] = useState<number | "">(50);
  const [inactLimit, setInactLimit] = useState<number | "">(10);

  // Step 2: cameras
  const [cameras, setCameras] = useState<CameraEntry[]>([]);
  const [camName, setCamName] = useState("");
  const [camSn, setCamSn] = useState("");
  const [camMode, setCamMode] = useState<"Add" | "Total">("Add");

  // Step 3: connectivity
  const [devices, setDevices] = useState<Device[]>([]);
  const [polling, setPolling] = useState(true);

  // Shared
  const [newShopId, setNewShopId] = useState<number | null>(null);
  const [newShopName, setNewShopName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const baseUrl = typeof location !== "undefined" ? location.origin : "";
  const stepLabels = ["Shop Details", "Add Cameras", "Verify Connectivity", "Review"];

  // Step 3: poll for device status
  useEffect(() => {
    if (step !== 2 || !polling) return;
    let cancelled = false;
    const poll = () => {
      api.devices().then(d => {
        if (!cancelled) setDevices(d);
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [step, polling]);

  function addCamera() {
    if (!camSn.trim() || !camName.trim()) return;
    setCameras(prev => [...prev, { sn: camSn.trim(), name: camName.trim(), mode: camMode }]);
    setCamSn("");
    setCamName("");
    setCamMode("Add");
  }

  function removeCamera(idx: number) {
    setCameras(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleNext() {
    setError("");
    setSubmitting(true);
    try {
      if (step === 0) {
        if (!shopName.trim()) { setError("Shop name is required"); setSubmitting(false); return; }
        const result = await api.createShop(adminToken || undefined, {
          name: shopName.trim(),
          timezoneOffsetMinutes: tzOffset === "" ? undefined : tzOffset,
          occupancyLimit: occLimit === "" ? undefined : occLimit,
          inactivityMinutes: inactLimit === "" ? undefined : inactLimit,
        });
        setNewShopId(result.id);
        setNewShopName(result.name);
        setStep(1);
      } else if (step === 1) {
        for (const cam of cameras) {
          await api.registerDevice(adminToken || undefined, {
            sn: cam.sn,
            name: cam.name,
            shopName: newShopName,
            dataMode: cam.mode,
            timezoneOffsetMinutes: tzOffset === "" ? undefined : tzOffset,
          });
        }
        setStep(2);
      } else if (step === 2) {
        setStep(3);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const cameraDevices = devices.filter(d => cameras.some(c => c.sn === d.sn));
  const allOnline = cameras.length > 0 && cameraDevices.every(d => d.status === "online");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] p-8 shadow-2xl shadow-black/40 backdrop-blur-xl" style={{ background: `color-mix(in srgb, var(--bg-from) 95%, transparent)` }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 rounded-t-2xl bg-gradient-to-b from-white/[var(--glass-shine)] to-transparent" />
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--text-muted)]">Step {step + 1} of 4</div>
            <div className="mt-1 text-lg font-semibold">{stepLabels[step]}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex justify-center">
          <Stepper current={step} total={4} />
        </div>

        {/* Error */}
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 shadow-lg shadow-rose-500/10 backdrop-blur-xl">{error}</div>
        ) : null}

        {/* Step 1: Shop Details */}
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Shop / Branch name</div>
              <input
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                placeholder="e.g. Westlands Branch"
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-sm outline-none backdrop-blur-sm focus:border-[var(--border-strong)]"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-[var(--text-muted)]">Timezone offset (min)</div>
                <input
                  type="number"
                  value={tzOffset}
                  onChange={e => setTzOffset(e.target.value === "" ? "" : Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-sm outline-none backdrop-blur-sm focus:border-[var(--border-strong)]"
                />
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Occupancy limit</div>
                <input
                  type="number"
                  value={occLimit}
                  onChange={e => setOccLimit(e.target.value === "" ? "" : Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-sm outline-none backdrop-blur-sm focus:border-[var(--border-strong)]"
                />
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Inactivity (min)</div>
                <input
                  type="number"
                  value={inactLimit}
                  onChange={e => setInactLimit(e.target.value === "" ? "" : Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-sm outline-none backdrop-blur-sm focus:border-[var(--border-strong)]"
                />
              </div>
            </div>
            <div className="text-xs text-[var(--text-muted)]">Nairobi = +180. This can be changed later.</div>
          </div>
        )}

        {/* Step 2: Add Cameras */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-[var(--text-muted)]">Camera name</div>
                <input
                  value={camName}
                  onChange={e => setCamName(e.target.value)}
                  placeholder="e.g. Entrance A"
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-sm outline-none backdrop-blur-sm focus:border-[var(--border-strong)]"
                />
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Serial number (SN)</div>
                <input
                  value={camSn}
                  onChange={e => setCamSn(e.target.value)}
                  placeholder="From the camera label"
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-sm font-mono outline-none backdrop-blur-sm focus:border-[var(--border-strong)]"
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)]">Data upload mode</div>
              <select
                value={camMode}
                onChange={e => setCamMode(e.target.value as "Add" | "Total")}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm backdrop-blur-md"
              >
                <option value="Add" className="bg-slate-900">Each upload is a count since last report (recommended)</option>
                <option value="Total" className="bg-slate-900">Each upload is a running total since boot</option>
              </select>
              <div className="mt-1.5 text-xs text-[var(--text-muted)]">
                {camMode === "Add"
                  ? "The camera sends how many people entered/exited since its last upload. This is the default and recommended mode."
                  : "The camera sends cumulative totals since it was powered on. The server calculates the difference automatically. Use this if the camera firmware is set to total/cumulative mode."}
              </div>
            </div>
            <button
              onClick={addCamera}
              disabled={!camSn.trim() || !camName.trim()}
              className="w-full rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-white/10 transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: `linear-gradient(to bottom, var(--accent-hover), var(--accent))`, boxShadow: `0 10px 15px -3px var(--accent-glow)` }}
            >
              Add camera
            </button>

            {cameras.length > 0 ? (
              <div className="space-y-2">
                {cameras.map((cam, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md px-3 py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold">{cam.name}</span>
                      <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">{cam.sn}</span>
                      <span className="ml-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] backdrop-blur-md">{cam.mode === "Add" ? "per-upload deltas" : "cumulative totals"}</span>
                    </div>
                    <button onClick={() => removeCamera(i)} className="text-xs text-[var(--text-muted)] hover:text-rose-300">Remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-3 text-sm text-[var(--text-muted)]">
                No cameras added yet. Add at least one camera for this branch.
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Skip — I'll add cameras later
            </button>
          </div>
        )}

        {/* Step 3: Connectivity Check */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="text-sm text-[var(--text-secondary)]">
              Enter these URLs in each camera's web UI under <span className="font-semibold">Server Address</span> or <span className="font-semibold">Push URL</span> settings:
            </div>
            <div className="space-y-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--text-muted)]">Heartbeat URL</div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(`${baseUrl}/api/camera/heartBeat`).catch(() => {})}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] backdrop-blur-sm hover:bg-[var(--surface-hover)]"
                  >Copy</button>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-[var(--text-secondary)]">{`${baseUrl}/api/camera/heartBeat`}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--text-muted)]">Data upload URL</div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(`${baseUrl}/api/camera/dataUpload`).catch(() => {})}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] backdrop-blur-sm hover:bg-[var(--surface-hover)]"
                  >Copy</button>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-[var(--text-secondary)]">{`${baseUrl}/api/camera/dataUpload`}</div>
              </div>
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Use your server's LAN IP or public domain — not <span className="font-mono">localhost</span> — since the camera needs to reach this server from the network.
            </div>

            {cameras.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-4 text-sm text-[var(--text-muted)]">
                No cameras registered to check. Go back to add cameras, or skip and configure later.
              </div>
            ) : (
              <>
                <div className="border-t border-[var(--border)] pt-4 text-sm text-[var(--text-secondary)]">
                  Camera status (auto-refreshing):
                </div>
                <div className="space-y-2">
                  {cameras.map(cam => {
                    const dev = cameraDevices.find(d => d.sn === cam.sn);
                    const isOnline = dev?.status === "online";
                    return (
                      <div key={cam.sn} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{cam.name}</div>
                          <div className="font-mono text-xs text-[var(--text-muted)]">{cam.sn}</div>
                        </div>
                        <div className="text-right">
                          {isOnline ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
                            </span>
                          ) : dev ? (
                            <span className="text-xs text-[var(--text-muted)]">Last seen {formatAgo(dev.last_seen)}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> Waiting...
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <GhostButton onClick={() => { setPolling(p => !p); }}>
                    {polling ? "Pause" : "Resume"}
                  </GhostButton>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 4: Review */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-4">
              <div className="text-sm font-semibold text-[var(--text-secondary)]">{newShopName}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Timezone offset: {tzOffset === "" ? 180 : tzOffset} min &middot; Occupancy limit: {occLimit === "" ? 50 : occLimit} &middot; Inactivity: {inactLimit === "" ? 10 : inactLimit} min
              </div>
            </div>
            {cameras.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-[var(--text-muted)]">Cameras ({cameras.length})</div>
                {cameras.map(cam => {
                  const dev = cameraDevices.find(d => d.sn === cam.sn);
                  return (
                    <div key={cam.sn} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md px-3 py-2">
                      <div>
                        <span className="text-sm font-semibold">{cam.name}</span>
                        <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">{cam.sn}</span>
                      </div>
                      <span className={`text-xs font-semibold ${dev?.status === "online" ? "text-emerald-300" : "text-[var(--text-muted)]"}`}>
                        {dev?.status ?? "offline"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/10 p-3 text-sm text-[var(--text-secondary)] shadow-lg backdrop-blur-xl">
              Setup complete! You can configure camera push URLs from the Setup tab.
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {step > 0 ? (
              <GhostButton onClick={() => { setError(""); setStep(s => s - 1); }}>Back</GhostButton>
            ) : (
              <GhostButton onClick={onClose}>Cancel</GhostButton>
            )}
          </div>
          <div className="flex gap-2">
            {step === 2 && (
              <GhostButton onClick={() => setStep(3)}>Skip</GhostButton>
            )}
            {step < 3 ? (
              <PrimaryButton
                disabled={submitting || (step === 1 && cameras.length === 0 && false)}
                onClick={handleNext}
              >
                {submitting ? "Saving..." : "Next"}
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => onComplete(newShopId ?? undefined)}>
                Done
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
