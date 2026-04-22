export type WsEvent =
  | { event: "connected"; data: { time: number } }
  | {
      event: "flow:update";
      data: {
        sn: string;
        time: number;
        mode: "Add" | "Total";
        counts: { in: number; out: number; passby: number; turnback: number };
        occupancy: { device: number; shop: number | null };
      };
    }
  | {
      event: "occupancy:update";
      data: { sn: string; occupancy: number; shopId: number | null; shopOccupancy: number | null };
    }
  | { event: string; data: unknown };

export function connectWs(onEvent: (e: WsEvent) => void): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.onmessage = msg => {
    try {
      onEvent(JSON.parse(String(msg.data)) as WsEvent);
    } catch {
      // ignore
    }
  };
  return () => ws.close();
}

