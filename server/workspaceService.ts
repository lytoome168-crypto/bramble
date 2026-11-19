import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Board, Notification, Person, WorkspaceData } from "../shared/work";
import { isOverdue, singaporeToday } from "../shared/work";
import { digestDeliveries, users, workspaceBoards, workspaceLogs, workspaceNotifications, workspacePeople, workspaceSchedules } from "../drizzle/schema";
import { getDb } from "./db";
import { cleanBoard } from "./workspaceValidation";
import { ensureWorkspace, groupColors, newId, personColors } from "./workspaceSeed";
import { advanceBoardRevision } from "./boardRevision";

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用，请稍后重试。" });
  return db;
}

export async function getWorkspace(userId: number): Promise<WorkspaceData> {
  await ensureWorkspace();
  const db = await database();
  const [boards, people, notices, logs, schedule] = await Promise.all([
    db.select().from(workspaceBoards), db.select().from(workspacePeople),
    db.select({ notice: workspaceNotifications }).from(workspaceNotifications)
      .innerJoin(workspacePeople, eq(workspaceNotifications.personId, workspacePeople.id))
      .where(sql`JSON_TYPE(JSON_EXTRACT(${workspacePeople.data}, '$.userId')) = 'INTEGER' AND JSON_EXTRACT(${workspacePeople.data}, '$.userId') = ${userId}`)
      .orderBy(desc(workspaceNotifications.createdAt)),
    db.select().from(workspaceLogs).orderBy(desc(workspaceLogs.createdAt)),
    db.select().from(workspaceSchedules).where(eq(workspaceSchedules.id, "shared")).limit(1),
  ]);
  const status = schedule[0]?.status ?? "not_configured";
  return {
    boards: boards.map(({ data }) => ({ ...data, automation: { ...data.automation, scheduleStatus: status } })),
    people: people.map(({ data }) => data),
    notifications: notices.map(({ notice: { isRead, ...notice } }) => ({ ...notice, read: Boolean(isRead) } as Notification)),
    logs: logs.map(({ dedupeKey: _dedupeKey, ...log }) => log),
  };
}

export async function saveBoard(input: Board): Promise<Board> {
  await ensureWorkspace();
  const db = await database();
  const candidate = cleanBoard(input);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(workspaceBoards).where(eq(workspaceBoards.id, candidate.id)).for("update");
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "看板不存在。" });
    const board = advanceBoardRevision(row.data, candidate);
    const people = await tx.select().from(workspacePeople);
    const personIds = new Set(people.map(p => p.id));
    if (board.items.some(item => item.assigneeId && !personIds.has(item.assigneeId))) throw new TRPCError({ code: "BAD_REQUEST", message: "条目负责人不存在。" });
    const previous = new Map(row.data.items.map(item => [item.id, item]));
    const now = new Date().toISOString();
    if (board.automation.completionEnabled) {
      for (const item of board.items) {
        const old = previous.get(item.id);
        if (old && old.status !== "done" && item.status === "done" && item.assigneeId) {
          await tx.insert(workspaceNotifications).values({ id: newId(), boardId: board.id, personId: item.assigneeId, title: "工作已完成", body: `「${item.name}」已完成。`, createdAt: now, isRead: 0, kind: "completion" });
          await tx.insert(workspaceLogs).values({ id: newId(), boardId: board.id, kind: "completion", status: "success", message: `「${item.name}」完成，已通知负责人。`, createdAt: now });
        }
      }
    }
    await tx.update(workspaceBoards).set({ data: board }).where(eq(workspaceBoards.id, board.id));
    const [schedule] = await tx.select().from(workspaceSchedules).where(eq(workspaceSchedules.id, "shared"));
    return { ...board, automation: { ...board.automation, scheduleStatus: schedule?.status ?? "not_configured" } };
  });
}

export async function createBoard(name: string): Promise<Board> {
  await ensureWorkspace();
  const db = await database();
  const board: Board = { id: newId(), name, description: "", groups: ["待办", "进行中", "已完成"].map((n, i) => ({ id: newId(), name: n, color: groupColors[i] })), items: [], customColumns: [], automation: { completionEnabled: true, digestEnabled: false } };
  await db.insert(workspaceBoards).values({ id: board.id, data: board });
  return board;
}
export async function createPerson(name: string, role: string): Promise<Person> {
  await ensureWorkspace();
  const db = await database();
  const person: Person = { id: newId(), name, role, color: personColors[Math.floor(Math.random() * personColors.length)], userId: null };
  await db.insert(workspacePeople).values({ id: person.id, data: person });
  return person;
}

/** Claim an unclaimed person, or atomically switch away from the caller's old person(s).
 * The user row serializes claims by one account; the target person row serializes
 * competing accounts. All writers of Person.userId must follow this protocol. */
export async function linkPerson(userId: number, personId: string): Promise<Person> {
  await ensureWorkspace();
  const db = await database();
  return db.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "用户不存在。" });

    const [target] = await tx.select().from(workspacePeople).where(eq(workspacePeople.id, personId)).for("update");
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在。" });
    if (target.data.userId != null && target.data.userId !== userId) {
      throw new TRPCError({ code: "CONFLICT", message: "该成员已关联其他用户。" });
    }

    // The first consistent read occurs only after acquiring the user's lock, so
    // it includes that account's previously committed links under InnoDB RR.
    const people = await tx.select().from(workspacePeople);
    for (const row of people) {
      if (row.id !== personId && row.data.userId === userId) {
        await tx.update(workspacePeople).set({ data: { ...row.data, userId: null } }).where(eq(workspacePeople.id, row.id));
      }
    }
    const person = { ...target.data, userId };
    await tx.update(workspacePeople).set({ data: person }).where(eq(workspacePeople.id, personId));
    return person;
  });
}

export async function persistGenerated(board: Board, people: Person[]): Promise<void> {
  await ensureWorkspace();
  const db = await database();
  await db.transaction(async tx => {
    await tx.insert(workspacePeople).values(people.map(p => ({ id: p.id, data: p })));
    await tx.insert(workspaceBoards).values({ id: board.id, data: board });
  });
}
export async function markRead(userId: number, id: string): Promise<{ success: true }> {
  await ensureWorkspace();
  const db = await database();
  return db.transaction(async tx => {
    const [notice] = await tx.select().from(workspaceNotifications).where(eq(workspaceNotifications.id, id)).for("update");
    if (!notice) throw new TRPCError({ code: "NOT_FOUND", message: "通知不存在。" });
    // Lock the person too, so an overlapping switch cannot invalidate the check
    // before the read flag is written. Missing and unauthorized are identical.
    const [person] = await tx.select().from(workspacePeople).where(eq(workspacePeople.id, notice.personId)).for("update");
    if (!person || person.data.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "通知不存在。" });
    await tx.update(workspaceNotifications).set({ isRead: 1 }).where(eq(workspaceNotifications.id, id));
    return { success: true };
  });
}

/** Manual and scheduled runs each deliver at most once per board/person/Singapore day.
 * Notice, delivery key, and first run log commit atomically under the board lock. */
export async function runBoardDigest(boardId: string, kind: "manual" | "scheduled", today = singaporeToday()): Promise<{ boardId: string; date: string; kind: "manual" | "scheduled"; delivered: number; skipped: number; message: string }> {
  const db = await database();
  try {
    return await db.transaction(async tx => {
    const [row] = await tx.select().from(workspaceBoards).where(eq(workspaceBoards.id, boardId)).for("update");
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "看板不存在。" });
    if (kind === "scheduled" && !row.data.automation.digestEnabled) return { boardId, date: today, kind, delivered: 0, skipped: 0, message: "定时摘要已关闭。" };
    const personRows = await tx.select().from(workspacePeople);
    const validPeople = new Set(personRows.map(p => p.id));
    const byPerson = new Map<string, typeof row.data.items>();
    for (const item of row.data.items) {
      if (!isOverdue(item, today) || !item.assigneeId || !validPeople.has(item.assigneeId)) continue;
      const list = byPerson.get(item.assigneeId) ?? [];
      list.push(item);
      byPerson.set(item.assigneeId, list);
    }
    let delivered = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    for (const [personId, items] of byPerson) {
      const [existing] = await tx.select().from(digestDeliveries).where(and(eq(digestDeliveries.boardId, boardId), eq(digestDeliveries.personId, personId), eq(digestDeliveries.singaporeDate, today), eq(digestDeliveries.kind, kind))).limit(1);
      if (existing) { skipped++; continue; }
      const notificationId = newId();
      // Database-enforced key and notification are committed together.
      await tx.insert(digestDeliveries).values({ id: newId(), boardId, personId, singaporeDate: today, kind, notificationId });
      const names = items.map(i => `「${i.name}」`).join('、');
      const preview = names.length > 4000 ? `${names.slice(0, 4000)}…` : names;
      await tx.insert(workspaceNotifications).values({ id: notificationId, boardId, personId, title: "逾期工作摘要", body: `截至 ${today}，你有 ${items.length} 项逾期工作：${preview}`, createdAt: now, isRead: 0, kind: "digest" });
      delivered++;
    }
    const dedupeKey = `${kind}:${boardId}:${today}`;
    const [existingLog] = await tx.select().from(workspaceLogs).where(eq(workspaceLogs.dedupeKey, dedupeKey));
    const message = delivered ? `已向 ${delivered} 位负责人发送逾期摘要。` : skipped ? "今天已发送过摘要，未重复发送。" : "没有需要发送的逾期工作。";
    if (!existingLog) await tx.insert(workspaceLogs).values({ id: newId(), boardId, kind, status: "success", message, createdAt: now, dedupeKey });
    return { boardId, date: today, kind, delivered, skipped, message };
    });
  } catch (error) {
    if (!(error instanceof TRPCError && error.code === "NOT_FOUND")) {
      try { await db.insert(workspaceLogs).values({ id: newId(), boardId, kind, status: "failed", message: "摘要运行失败，请重试。", createdAt: new Date().toISOString() }); }
      catch (logError) { console.error("[Digest] Could not persist failure log:", logError); }
    }
    throw error;
  }
}
export async function runAllScheduledDigests() {
  await ensureWorkspace();
  const db = await database();
  const boards = await db.select({ id: workspaceBoards.id }).from(workspaceBoards);
  const results = [];
  for (const board of boards) results.push(await runBoardDigest(board.id, "scheduled"));
  return results;
}
