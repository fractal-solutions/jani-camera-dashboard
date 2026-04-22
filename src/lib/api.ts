type ApiEnvelope<T> = { code: number; msg: string; data: T };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (body.code !== 0) throw new Error(body.msg || "API error");
  return body.data;
}

export type Shop = {
  id: number;
  name: string;
  timezone: string | null;
  occupancy_limit: number;
  inactivity_minutes_limit: number;
};

export type Device = {
  sn: string;
  name: string;
  last_seen: number | null;
  status: string;
  data_mode: "Add" | "Total";
  ip_address: string | null;
  mac_address: string | null;
  shop_name: string | null;
  shop_id: number | null;
};

export type Overview = {
  now: number;
  start: number;
  visitors: number;
  passby: number;
  turnback: number;
  avgDwellMs: number | null;
  peakNetPerMinute: number;
  occupancy: number | null;
};

export type LiveTraffic = {
  now: number;
  start: number;
  minutes: number;
  points: { bucket: string; in_sum: number; out_sum: number }[];
};

export type Analytics = {
  traffic: {
    now: number;
    start: number;
    range: "today" | "week" | "month";
    points: { bucket: string; in_sum: number; out_sum: number; pass_sum: number }[];
  };
  demographics: {
    now: number;
    start: number;
    range: "today" | "week" | "month";
    gender: { gender: number | null; cnt: number }[];
    age: { bucket: string; cnt: number }[];
  };
};

export const api = {
  shops: () => getJson<Shop[]>("/api/shops"),
  devices: () => getJson<Device[]>("/api/devices"),
  overview: (shopId?: number) => getJson<Overview>(shopId ? `/api/overview?shopId=${shopId}` : "/api/overview"),
  liveTraffic: (shopId?: number, minutes = 60) =>
    getJson<LiveTraffic>(`/api/traffic/live?minutes=${minutes}${shopId ? `&shopId=${shopId}` : ""}`),
  analytics: (range: "today" | "week" | "month", shopId?: number) =>
    getJson<Analytics>(`/api/analytics?range=${range}${shopId ? `&shopId=${shopId}` : ""}`),
};

