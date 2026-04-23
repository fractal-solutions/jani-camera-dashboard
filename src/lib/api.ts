type ApiEnvelope<T> = { code: number; msg: string; data: T };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (body.code !== 0) throw new Error(body.msg || "API error");
  return body.data;
}

async function postJson<T>(path: string, payload: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (body.code !== 0) throw new Error(body.msg || "API error");
  return body.data;
}

export type Shop = {
  id: number;
  name: string;
  timezone: string | null;
  timezone_offset_minutes: number;
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
  peakOccupancy: number;
  returnVisitors: number;
  occupancy: number | null;
  timezoneOffsetMinutes?: number;
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

export type PersonRow = {
  person_id: string;
  last_seen: number;
  events: number;
  enters: number;
  leaves: number;
  returns: number;
  pass: number;
  gender: number | null;
  age_min: number | null;
  age_max: number | null;
  label: string | null;
};

export const api = {
  shops: () => getJson<Shop[]>("/api/shops"),
  devices: () => getJson<Device[]>("/api/devices"),
  overview: (shopId?: number) => getJson<Overview>(shopId ? `/api/overview?shopId=${shopId}` : "/api/overview"),
  liveTraffic: (shopId?: number, minutes = 60) =>
    getJson<LiveTraffic>(`/api/traffic/live?minutes=${minutes}${shopId ? `&shopId=${shopId}` : ""}`),
  analytics: (range: "today" | "week" | "month", shopId?: number) =>
    getJson<Analytics>(`/api/analytics?range=${range}${shopId ? `&shopId=${shopId}` : ""}`),
  people: (sn: string, limit = 100) => getJson<PersonRow[]>(`/api/people?sn=${encodeURIComponent(sn)}&limit=${limit}`),
  labelPerson: (token: string, sn: string, personId: string, label: string) =>
    postJson<{ sn: string; personId: string; label: string }>(
      "/api/admin/labelPerson",
      { sn, personId, label },
      { "x-admin-token": token },
    ),
};
