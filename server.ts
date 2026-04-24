/**
 * Custom Next.js server.
 *
 * Responsibilities:
 *  - Run Next.js HTTP handler.
 *  - Run a WebSocket server at /ws/peer for follower<->leader replication.
 *  - Run DB migrations on startup.
 *  - Start the replication coordinator.
 */
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { parse } from "node:url";

import { config } from "./src/server/config";
import { logger } from "./src/server/logger";
import { ensureMigrated } from "./src/db/migrate";
import { startCoordinator } from "./src/server/replication/coordinator";
import { startLeaderHub } from "./src/server/replication/leader-hub";
import { onRoleChange } from "./src/server/replication/state";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: config.hostname, port: config.port });
const handle = app.getRequestHandler();

async function main() {
  logger.info({ kioskId: config.kioskId, port: config.port }, "starting kiosk");

  ensureMigrated();
  logger.info("database migrations applied");

  await app.prepare();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    void handle(req, res, parsedUrl);
  });

  // WebSocket server for peer replication.
  const wss = new WebSocketServer({ noServer: true });
  startLeaderHub(wss);

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/");
    if (pathname === "/ws/peer") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  httpServer.listen(config.port, config.hostname, () => {
    logger.info(
      { url: `http://${config.hostname}:${config.port}` },
      "kiosk listening",
    );
    // Start replication after the HTTP server is up so peers can probe us.
    startCoordinator();
  });

  onRoleChange((role) => logger.info({ role }, "role changed"));

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "fatal startup error");
  process.exit(1);
});

// Next.js 15 dev mode occasionally throws ERR_MODULE_NOT_FOUND for internal
// vendor-chunks worker files, and thread-stream (pino) throws "worker thread
// exited" when that same Next worker dies. Both are benign in dev — requests
// keep succeeding and the server stays up. Swallow them so the process keeps
// running and replication stays stable.
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (
    (err.code === "ERR_MODULE_NOT_FOUND" && err.message?.includes("vendor-chunks")) ||
    err.message === "the worker thread exited"
  ) {
    return; // suppress Next.js internal worker hot-reload noise
  }
  logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception");
  process.exit(1);
});
