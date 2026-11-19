import type { Express } from "express";
import { parse as parseCookies } from "cookie";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { workspaceSchedules } from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { runAllScheduledDigests } from "./workspaceService";
import { CALLBACK_PATH } from "./workspaceSchedule";

export function registerScheduledDigest(app: Express) {
  app.post(CALLBACK_PATH, async (req, res) => {
    const token = parseCookies(req.headers.cookie ?? "").app_session_id;
    if (!token || !ENV.cookieSecret || !ENV.appId) { res.status(401).json({ error: "Missing scheduler credential" }); return; }
    let openId: string;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(ENV.cookieSecret), { algorithms: ["HS256"], requiredClaims: ["exp"] });
      if (payload.appId !== ENV.appId || typeof payload.openId !== "string" || !payload.openId.startsWith("cron_") || typeof payload.name !== "string") throw new Error("Invalid cron claims");
      openId = payload.openId;
    } catch {
      res.status(401).json({ error: "Invalid scheduler credential" }); return;
    }
    try {
      const identity = await sdk.getUserInfoWithJwt(token);
      if (identity.openId !== openId || identity.projectId !== ENV.appId || !identity.taskUid) { res.status(403).json({ error: "Unrecognized scheduler identity" }); return; }
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [schedule] = await db.select().from(workspaceSchedules).where(eq(workspaceSchedules.taskUid, identity.taskUid)).limit(1);
      if (!schedule || schedule.id !== "shared" || schedule.status !== "active") { res.status(403).json({ error: "Unregistered scheduler task" }); return; }
      // Only the authenticated taskUid selects the workspace; callback body is ignored.
      const results = await runAllScheduledDigests();
      res.json({ success: true, results });
    } catch (error) {
      console.error("[Scheduled digest] callback failed:", error);
      res.status(503).json({ error: "Scheduler identity lookup or digest execution failed" });
    }
  });
}
