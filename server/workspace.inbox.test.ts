import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { users, workspaceBoards, workspaceLogs, workspaceNotifications, workspacePeople, workspaceSchedules } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({ getDb: async () => mocks.db }));
vi.mock("./workspaceSeed", async importOriginal => ({
  ...await importOriginal<typeof import("./workspaceSeed")>(),
  ensureWorkspace: vi.fn(async () => {}),
}));

import { appRouter } from "./routers";

const dialect = new MySqlDialect();
const tables = [users, workspaceBoards, workspacePeople, workspaceNotifications, workspaceLogs, workspaceSchedules];
const tableName = (table: any) => {
  const index = tables.indexOf(table);
  if (index < 0) throw new Error("Unexpected table");
  return ["users", "boards", "people", "notices", "logs", "schedules"][index];
};
type Row = Record<string, any>;
const copy = <T,>(value: T): T => structuredClone(value);

/** Small transactional fake with FIFO row locks and staged writes, not a SQL/database server. */
class FakeDb {
  data: Record<string, Row[]> = {
    users: [{ id: 1 }, { id: 2 }, { id: 3 }],
    boards: [{ id: "board", data: { id: "board", automation: { digestEnabled: true } } }],
    people: [
      { id: "alice", data: { id: "alice", name: "Alice", role: "Dev", color: "red", userId: 1 } },
      { id: "bob", data: { id: "bob", name: "Bob", role: "Dev", color: "blue", userId: 2 } },
      { id: "free", data: { id: "free", name: "Free", role: "Dev", color: "green", userId: null } },
      { id: "old", data: { id: "old", name: "Old", role: "Dev", color: "yellow" } },
    ],
    notices: [
      { id: "a", personId: "alice", boardId: "board", title: "A", body: "A", createdAt: "2026-01-01", isRead: 0, kind: "completion" },
      { id: "b", personId: "bob", boardId: "board", title: "B", body: "B", createdAt: "2026-01-03", isRead: 0, kind: "digest" },
      { id: "f", personId: "free", boardId: "board", title: "F", body: "F", createdAt: "2026-01-02", isRead: 0, kind: "digest" },
      { id: "orphan", personId: "missing", boardId: "board", title: "O", body: "O", createdAt: "2026-01-04", isRead: 0, kind: "digest" },
    ],
    logs: [{ id: "log", boardId: "board", kind: "manual", status: "success", message: "ok", createdAt: "2026-01-01", dedupeKey: "key" }],
    schedules: [{ id: "shared", status: "active" }],
  };
  locks = new Map<string, Promise<void>>();
  lockEvents: string[] = [];
  ownershipQueries: Array<{ sql: string; params: unknown[]; join: string }> = [];
  failUpdatePersonId: string | null = null;
  afterForLock?: (key: string) => Promise<void>;

  select(_fields?: unknown) { return new Query(this); }
  insert(table: any) {
    const name = tableName(table);
    return { values: async (row: Row) => { this.data[name].push(copy(row)); } };
  }
  async transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const tx = new FakeTx(this);
    try {
      const result = await fn(tx);
      for (const [key, value] of tx.writes) {
        const split = key.indexOf(":");
        const table = key.slice(0, split);
        const id = key.slice(split + 1);
        const index = this.data[table].findIndex(row => String(row.id) === id);
        this.data[table][index] = copy(value);
      }
      return result;
    } finally {
      for (const release of tx.releases.reverse()) release();
    }
  }
}
class FakeTx {
  writes = new Map<string, Row>();
  releases: Array<() => void> = [];
  held = new Set<string>();
  constructor(public db: FakeDb) {}
  select(_fields?: unknown) { return new Query(this.db, this); }
  async lock(table: string, id: unknown) {
    const key = `${table}:${id}`;
    if (this.held.has(key)) return;
    this.db.lockEvents.push(key);
    const previous = this.db.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.db.locks.set(key, next);
    await previous;
    this.held.add(key);
    this.releases.push(() => {
      if (this.db.locks.get(key) === next) this.db.locks.delete(key);
      release();
    });
  }
  update(table: any) {
    const name = tableName(table);
    return { set: (values: Row) => ({ where: async (condition: any) => {
      const { params } = dialect.sqlToQuery(condition);
      const id = params[0];
      await this.lock(name, id);
      if (name === "people" && id === this.db.failUpdatePersonId) throw new Error("simulated write failure");
      const key = `${name}:${id}`;
      const row = this.writes.get(key) ?? this.db.data[name].find(r => r.id === id);
      if (!row) throw new Error(`Missing row ${key}`);
      this.writes.set(key, { ...copy(row), ...copy(values) });
    } }) };
  }
}
class Query implements PromiseLike<Row[]> {
  table: any;
  condition: any;
  joined: any;
  joinCondition: any;
  constructor(public db: FakeDb, public tx?: FakeTx) {}
  from(table: any) { this.table = table; return this; }
  where(condition: any) { this.condition = condition; return this; }
  innerJoin(table: any, condition: any) { this.joined = table; this.joinCondition = condition; return this; }
  orderBy(_expression: any) { return this; }
  limit(_n: number) { return this; }
  async for(mode: string) {
    expect(mode).toBe("update");
    if (!this.tx || !this.condition) throw new Error("Expected transaction and row predicate");
    const name = tableName(this.table);
    const id = dialect.sqlToQuery(this.condition).params[0];
    await this.tx.lock(name, id);
    if (this.db.afterForLock) await this.db.afterForLock(`${name}:${id}`);
    return this.execute();
  }
  async execute(): Promise<Row[]> {
    const name = tableName(this.table);
    const sql = this.condition ? dialect.sqlToQuery(this.condition) : undefined;
    if (this.joined) {
      expect(name).toBe("notices");
      expect(this.joined).toBe(workspacePeople);
      const join = dialect.sqlToQuery(this.joinCondition).sql;
      if (!sql || !sql.sql.includes("JSON_TYPE") || !sql.sql.includes("JSON_EXTRACT")) throw new Error("Inbox must filter ownership in SQL");
      this.db.ownershipQueries.push({ sql: sql.sql, params: sql.params, join });
      return copy(this.db.data.notices
        .filter(notice => this.db.data.people.some(person => person.id === notice.personId && person.data.userId === sql.params[0]))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(notice => ({ notice })));
    }
    let rows = this.db.data[name].map(row => this.tx?.writes.get(`${name}:${row.id}`) ?? row);
    if (sql) rows = rows.filter(row => row.id === sql.params[0]);
    return copy(rows);
  }
  then<TResult1 = Row[], TResult2 = never>(onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

function caller(id?: number, cron = false) {
  const user = id === undefined ? null : {
    id, openId: `user-${id}`, name: "User", email: null, loginMethod: "test", role: "user" as const,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), ...(cron ? { isCron: true } : {}),
  };
  return appRouter.createCaller({ req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], user });
}
let db: FakeDb;
beforeEach(() => { db = new FakeDb(); mocks.db = db; });

function owner(id: string) { return db.data.people.find(row => row.id === id)?.data.userId; }
function read(id: string) { return db.data.notices.find(row => row.id === id)?.isRead; }

describe("personal workspace inbox", () => {
  it("requires a real authenticated user, validates IDs, and excludes cron identities", async () => {
    await expect(caller().workspace.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().workspace.linkPerson({ personId: "free" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().workspace.markRead({ id: "a" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(1, true).workspace.linkPerson({ personId: "free" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(1, true).workspace.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(1, true).workspace.markRead({ id: "a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(1).workspace.linkPerson({ personId: "invalid id" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("preserves shared data but selects only linked notices using a parameterized ownership join", async () => {
    const first = await caller(1).workspace.get();
    expect(first.people.map(p => p.id)).toEqual(["alice", "bob", "free", "old"]);
    expect(first.boards[0].automation.scheduleStatus).toBe("active");
    expect(first.logs).toHaveLength(1);
    expect(first.logs[0]).not.toHaveProperty("dedupeKey");
    expect(first.notifications.map(n => [n.id, n.read])).toEqual([["a", false]]);
    expect((await caller(2).workspace.get()).notifications.map(n => n.id)).toEqual(["b"]);
    expect((await caller(3).workspace.get()).notifications).toEqual([]);
    expect(db.ownershipQueries[0]).toMatchObject({
      params: [1],
      join: "`workspace_notifications`.`personId` = `workspace_people`.`id`",
    });
    expect(db.ownershipQueries[0].sql).toContain("JSON_TYPE(JSON_EXTRACT(`workspace_people`.`data`, '$.userId')) = 'INTEGER'");
    expect(db.ownershipQueries[0].sql).toContain("JSON_EXTRACT(`workspace_people`.`data`, '$.userId') = ?");
  });

  it("returns every legacy linked person's notices and repairs duplicate links on claim", async () => {
    db.data.people.find(row => row.id === "free")!.data.userId = 1;
    expect((await caller(1).workspace.get()).notifications.map(n => n.id)).toEqual(["f", "a"]);
    await caller(1).workspace.linkPerson({ personId: "old" });
    expect(owner("alice")).toBeNull();
    expect(owner("free")).toBeNull();
    expect(owner("old")).toBe(1);
  });

  it("creates ordinary people unclaimed", async () => {
    const person = await caller(1).workspace.createPerson({ name: "New", role: "Dev" });
    expect(person.userId).toBeNull();
    expect(owner(person.id)).toBeNull();
  });

  it("claims and switches atomically, including old records without userId", async () => {
    const c = caller(1);
    const result = await c.workspace.linkPerson({ personId: "free" });
    expect(result).toMatchObject({ id: "free", userId: 1 });
    expect(owner("alice")).toBeNull();
    expect(owner("free")).toBe(1);
    expect((await c.workspace.get()).notifications.map(n => n.id)).toEqual(["f"]);
    expect(await c.workspace.linkPerson({ personId: "free" })).toEqual(result);
    expect(await caller(3).workspace.linkPerson({ personId: "old" })).toMatchObject({ userId: 3 });
    expect(db.lockEvents).toContain("users:1");
    expect(db.lockEvents).toContain("people:free");
  });

  it("rejects missing and other-owned people without unlinking the current person", async () => {
    await expect(caller(1).workspace.linkPerson({ personId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(1).workspace.linkPerson({ personId: "bob" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(owner("alice")).toBe(1);
    expect(owner("bob")).toBe(2);
    await expect(caller(99).workspace.linkPerson({ personId: "free" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rolls back an old unlink if a later write fails", async () => {
    db.failUpdatePersonId = "free";
    await expect(caller(1).workspace.linkPerson({ personId: "free" })).rejects.toThrow();
    expect(owner("alice")).toBe(1);
    expect(owner("free")).toBeNull();
  });

  it("serializes competing accounts for one person", async () => {
    const results = await Promise.allSettled([
      caller(1).workspace.linkPerson({ personId: "free" }),
      caller(2).workspace.linkPerson({ personId: "free" }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
    const winner = owner("free");
    expect([1, 2]).toContain(winner);
    expect(db.data.people.filter(row => row.data.userId === winner)).toHaveLength(1);
    expect(db.lockEvents.filter(key => key === "people:free")).toHaveLength(2);
  });

  it("serializes simultaneous claims by one account, leaving just one linked person", async () => {
    await Promise.all([
      caller(3).workspace.linkPerson({ personId: "free" }),
      caller(3).workspace.linkPerson({ personId: "old" }),
    ]);
    expect(db.data.people.filter(row => row.data.userId === 3)).toHaveLength(1);
    expect(db.lockEvents.filter(key => key === "users:3")).toHaveLength(2);
  });

  it("allows only the linked user to mark a notice read, even after switching", async () => {
    await expect(caller(1).workspace.markRead({ id: "b" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(3).workspace.markRead({ id: "f" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(1).workspace.markRead({ id: "orphan" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(1).workspace.markRead({ id: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(read("b")).toBe(0);
    expect(read("f")).toBe(0);
    expect(await caller(1).workspace.markRead({ id: "a" })).toEqual({ success: true });
    expect(await caller(1).workspace.markRead({ id: "a" })).toEqual({ success: true });
    expect(read("a")).toBe(1);
    await caller(1).workspace.linkPerson({ personId: "free" });
    await expect(caller(1).workspace.markRead({ id: "a" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await caller(1).workspace.markRead({ id: "f" })).toEqual({ success: true });
    expect(read("f")).toBe(1);
    expect(db.lockEvents).toContain("notices:a");
    expect(db.lockEvents).toContain("people:alice");
  });

  it("rechecks the person under lock when a switch races a mark-read", async () => {
    let paused!: () => void;
    let resume!: () => void;
    const pauseReached = new Promise<void>(resolve => { paused = resolve; });
    const continueRead = new Promise<void>(resolve => { resume = resolve; });
    db.afterForLock = async key => {
      if (key === "notices:a") { paused(); await continueRead; }
    };
    const mark = caller(1).workspace.markRead({ id: "a" });
    await pauseReached;
    await caller(1).workspace.linkPerson({ personId: "free" });
    resume();
    await expect(mark).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(read("a")).toBe(0);
  });

  it("ignores an input userId and uses the authenticated account", async () => {
    await caller(3).workspace.linkPerson({ personId: "free", userId: 2 } as any);
    expect(owner("free")).toBe(3);
    await expect(caller(3).workspace.markRead({ id: "b", userId: 2 } as any)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(read("b")).toBe(0);
  });
});
