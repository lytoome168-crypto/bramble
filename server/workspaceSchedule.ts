import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { workspaceSchedules } from "../drizzle/schema";
import { getDb } from "./db";
import { createHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob } from "./_core/heartbeat";

const JOB_NAME = "bramble-shared-daily-overdue-digest";
export const CALLBACK_PATH = "/api/scheduled/digest";
export const DIGEST_CRON = "0 0 0 * * *"; // 08:00 every day in Asia/Singapore

async function findExistingJob(): Promise<string | null> {
  let page = 1;
  while (true) {
    const result = await listHeartbeatJobs("", { page, pageSize: 200 });
    const match = result.jobs.find(job => job.name === JOB_NAME);
    if (match) return match.taskUid;
    if (result.jobs.length < 200 || page * 200 >= result.total) return null;
    page++;
  }
}

/** Only call after the version with the callback is published. Uses project-owner identity. */
export async function ensureDigestSchedule(): Promise<{ taskUid: string; status: "active"; cron: string; timezone: "Asia/Singapore" }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用。" });
  return db.transaction(async tx => {
    await tx.insert(workspaceSchedules).values({ id: "shared", status: "not_configured" }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
    const [row] = await tx.select().from(workspaceSchedules).where(eq(workspaceSchedules.id, "shared")).for("update");
    // Discover the owner job before creating, including recovery from a remote create
    // that succeeded just before the database transaction failed.
    let taskUid = row.taskUid ?? await findExistingJob();
    const patch = { cron: DIGEST_CRON, path: CALLBACK_PATH, method: "POST" as const, payload: {}, enable: true, description: "Daily in-app overdue digest at 08:00 Singapore time" };
    if (taskUid) {
      try {
        await updateHeartbeatJob(taskUid, patch, "");
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error;
        // A job may have been deleted outside the app. Only a confirmed 404 permits recreation.
        const replacement = await findExistingJob();
        if (replacement && replacement !== taskUid) {
          await updateHeartbeatJob(replacement, patch, "");
          taskUid = replacement;
        } else taskUid = null;
      }
    }
    if (!taskUid) {
      const created = await createHeartbeatJob({ name: JOB_NAME, cron: DIGEST_CRON, path: CALLBACK_PATH, method: "POST", payload: {}, description: "Daily in-app overdue digest at 08:00 Singapore time" }, "");
      if (!created.taskUid) throw new Error("Heartbeat did not return a task UID");
      taskUid = created.taskUid;
    }
    await tx.update(workspaceSchedules).set({ taskUid, status: "active" }).where(eq(workspaceSchedules.id, "shared"));
    return { taskUid, status: "active" as const, cron: DIGEST_CRON, timezone: "Asia/Singapore" as const };
  });
}
