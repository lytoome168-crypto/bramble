import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { SignJWT } from "jose";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), run: vi.fn(), where: vi.fn(), selected: [] as unknown[] }));
vi.mock("./_core/sdk", () => ({ sdk: { getUserInfoWithJwt: mocks.identity } }));
vi.mock("./workspaceService", () => ({ runAllScheduledDigests: mocks.run }));
vi.mock("./db", () => ({ getDb: async () => ({ select: () => ({ from: () => ({ where: (condition: unknown) => { mocks.where(condition); return { limit: async () => mocks.selected }; } }) }) }) }));
vi.mock("drizzle-orm", async importOriginal => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: (column: unknown, value: unknown) => ({ column, value }) };
});
import { registerScheduledDigest } from "./scheduledDigest";

let server: { address(): unknown; close(callback: () => void): unknown };
let base: string;
let oldSecret: string | undefined;
let oldProject: string | undefined;
async function token(payload: Record<string, unknown>, withExpiry = true) {
  let signer = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
  if (withExpiry) signer = signer.setExpirationTime("5m");
  return signer.sign(new TextEncoder().encode("test-scheduler-secret"));
}
async function post(jwt?: string, body = {}) {
  return fetch(`${base}/api/scheduled/digest`, { method: "POST", headers: { "content-type": "application/json", ...(jwt ? { cookie: `app_session_id=${jwt}` } : {}) }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  oldSecret = process.env.MANUS_JWT_SECRET; oldProject = process.env.MANUS_PROJECT_ID;
  process.env.MANUS_JWT_SECRET = "test-scheduler-secret"; process.env.MANUS_PROJECT_ID = "project-test";
  const app = express(); app.use(express.json()); registerScheduledDigest(app);
  server = await new Promise<typeof server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (oldSecret === undefined) delete process.env.MANUS_JWT_SECRET; else process.env.MANUS_JWT_SECRET = oldSecret;
  if (oldProject === undefined) delete process.env.MANUS_PROJECT_ID; else process.env.MANUS_PROJECT_ID = oldProject;
});
describe("scheduler callback", () => {
  it("rejects absent, unsigned, expired-claim-free, wrong-project, and non-cron credentials", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("not-a-jwt")).status).toBe(401);
    expect((await post(await token({ openId: "cron_123", appId: "project-test", name: "cron" }, false))).status).toBe(401);
    expect((await post(await token({ openId: "cron_123", appId: "other", name: "cron" }))).status).toBe(401);
    expect((await post(await token({ openId: "human", appId: "project-test", name: "human" }))).status).toBe(401);
  });
  it("uses the taskUid returned by the authenticated identity lookup, not the body", async () => {
    const jwt = await token({ openId: "cron_123", appId: "project-test", name: "cron" });
    mocks.identity.mockResolvedValue({ openId: "cron_123", projectId: "project-test", taskUid: "trusted-task" });
    mocks.selected = [{ id: "shared", status: "active" }];
    mocks.run.mockResolvedValue([]);
    const response = await post(jwt, { taskUid: "attacker-controlled", boardId: "different" });
    expect(response.status).toBe(200);
    expect(mocks.identity).toHaveBeenCalledWith(jwt);
    expect(mocks.where).toHaveBeenLastCalledWith(expect.objectContaining({ value: "trusted-task" }));
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it("rejects an identity inconsistent with its verified claims", async () => {
    const jwt = await token({ openId: "cron_123", appId: "project-test", name: "cron" });
    mocks.identity.mockResolvedValue({ openId: "cron_other", projectId: "project-test", taskUid: "trusted-task" });
    expect((await post(jwt)).status).toBe(403);
  });
});
