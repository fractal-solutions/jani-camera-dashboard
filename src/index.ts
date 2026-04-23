import { serve } from "bun";
import index from "./index.html";
import { createApi } from "./server/routes";
import { WsHub } from "./server/ws";

const hub = new WsHub();
let api: ReturnType<typeof createApi> | null = null;

function apiHandler(req: Request, server: Parameters<NonNullable<Bun.ServeOptions["fetch"]>>[1]) {
  api ??= createApi(server, hub);
  return api.handle(req) ?? new Response("Not found", { status: 404 });
}

const server = serve({
  port: Number(process.env.PORT ?? "10101"),
  routes: {
    "/ws": (req, server) => {
      if (server.upgrade(req)) return;
      return new Response("Upgrade required", { status: 426 });
    },

    // API routes
    "/api/health": apiHandler,
    "/api/admin/registerDevice": apiHandler,
    "/api/admin/updateShop": apiHandler,
    "/api/admin/labelPerson": apiHandler,
    "/api/admin/deleteDevice": apiHandler,
    "/api/devices": apiHandler,
    "/api/shops": apiHandler,
    "/api/overview": apiHandler,
    "/api/analytics": apiHandler,
    "/api/traffic/live": apiHandler,
    "/api/people": apiHandler,
    "/api/camera/heartBeat": apiHandler,
    "/api/camera/dataUpload": apiHandler,
    "/api/camera/dup": apiHandler,
    "/api/camera/reid": apiHandler,
    "/api/labels": apiHandler,

    "/dup": apiHandler,
    "/reid": apiHandler,

    // Frontend + dev bundling/HMR
    "/*": index,
  },
  websocket: {
    open(ws) {
      hub.add(ws);
      ws.send(JSON.stringify({ event: "connected", data: { time: Math.floor(Date.now() / 1000) } }));
    },
    close(ws) {
      hub.remove(ws);
    },
    message(ws, message) {
      if (typeof message === "string" && message === "ping") ws.send("pong");
    },
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
