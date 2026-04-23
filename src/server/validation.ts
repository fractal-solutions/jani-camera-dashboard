import type { DataMode } from "./config";

export type HeartbeatPayload = {
  sn: string;
  timestamp: number;
  ipAddress?: string;
  macAddress?: string;
  timeZone?: number;
  [k: string]: unknown;
};

export type DataUploadAttribute = {
  personId?: string;
  eventType?: number;
  gender?: number;
  age?: [number, number];
  height?: number;
  stayTime?: number;
};

export type DataUploadPayload = {
  sn: string;
  startTime?: number;
  endTime?: number;
  time: number;
  in: number;
  out: number;
  passby: number;
  turnback: number;
  avgStayTime?: number;
  attributes?: DataUploadAttribute[];
  dataMode?: DataMode;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asInt(v: unknown, field: string, required = true): number | undefined {
  if (v === undefined || v === null) {
    if (required) throw new Error(`missing field: ${field}`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`invalid number: ${field}`);
  return Math.trunc(v);
}

function asString(v: unknown, field: string, required = true): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw new Error(`missing field: ${field}`);
    return undefined;
  }
  if (typeof v !== "string" || v.trim().length === 0) throw new Error(`invalid string: ${field}`);
  return v;
}

export function parseHeartbeat(body: unknown): HeartbeatPayload {
  if (!isObj(body)) throw new Error("body must be an object");
  return {
    sn: asString(body.sn, "sn")!,
    timestamp: asInt(body.timestamp, "timestamp")!,
    ipAddress: typeof body.ipAddress === "string" ? body.ipAddress : undefined,
    macAddress: typeof body.macAddress === "string" ? body.macAddress : undefined,
    timeZone: typeof body.timeZone === "number" ? Math.trunc(body.timeZone) : undefined,
    ...body,
  };
}

export function parseDataUpload(body: unknown): DataUploadPayload {
  if (!isObj(body)) throw new Error("body must be an object");
  const attributesRaw = body.attributes;
  const attributes =
    Array.isArray(attributesRaw) ?
      attributesRaw
        .filter(a => typeof a === "object" && a !== null)
        .map(a => {
          const attr = a as Record<string, unknown>;
          const age = Array.isArray(attr.age) && attr.age.length === 2 ? [Number(attr.age[0]), Number(attr.age[1])] : undefined;
          return {
            personId:
              typeof attr.personId === "string" ? attr.personId
              : typeof attr.personId === "number" ? String(Math.trunc(attr.personId))
              : undefined,
            eventType: typeof attr.eventType === "number" ? Math.trunc(attr.eventType) : undefined,
            gender: typeof attr.gender === "number" ? Math.trunc(attr.gender) : undefined,
            age: age ? [Math.trunc(age[0] ?? 0), Math.trunc(age[1] ?? 0)] : undefined,
            height: typeof attr.height === "number" ? attr.height : undefined,
            stayTime: typeof attr.stayTime === "number" ? Math.trunc(attr.stayTime) : undefined,
          };
        })
      : undefined;

  const dataMode = body.dataMode === "Add" || body.dataMode === "Total" ? (body.dataMode as DataMode) : undefined;

  return {
    sn: asString(body.sn, "sn")!,
    startTime: asInt(body.startTime, "startTime", false),
    endTime: asInt(body.endTime, "endTime", false),
    time: asInt(body.time, "time")!,
    in: asInt(body.in, "in") ?? 0,
    out: asInt(body.out, "out") ?? 0,
    passby: asInt(body.passby, "passby") ?? 0,
    turnback: asInt(body.turnback, "turnback") ?? 0,
    avgStayTime: asInt(body.avgStayTime, "avgStayTime", false),
    attributes,
    dataMode,
  };
}
