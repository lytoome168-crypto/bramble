import { int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type { Board, Person } from "../shared/work";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// One shared, explicitly seeded workspace; each board is updated under a row lock.
export const workspaceMeta = mysqlTable("workspace_meta", {
  id: varchar("id", { length: 32 }).primaryKey(),
  seeded: int("seeded").notNull().default(0),
});
export const workspaceBoards = mysqlTable("workspace_boards", {
  id: varchar("id", { length: 64 }).primaryKey(),
  data: json("data").$type<Board>().notNull(),
});
export const workspacePeople = mysqlTable("workspace_people", {
  id: varchar("id", { length: 64 }).primaryKey(),
  data: json("data").$type<Person>().notNull(),
});
export const workspaceNotifications = mysqlTable("workspace_notifications", {
  id: varchar("id", { length: 64 }).primaryKey(),
  boardId: varchar("boardId", { length: 64 }).notNull(),
  personId: varchar("personId", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  createdAt: varchar("createdAt", { length: 32 }).notNull(),
  isRead: int("isRead").notNull().default(0),
  kind: mysqlEnum("kind", ["completion", "digest"]).notNull(),
});
export const workspaceLogs = mysqlTable("workspace_logs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  boardId: varchar("boardId", { length: 64 }).notNull(),
  kind: mysqlEnum("kind", ["manual", "scheduled", "completion"]).notNull(),
  status: varchar("status", { length: 64 }).notNull(),
  message: text("message").notNull(),
  createdAt: varchar("createdAt", { length: 32 }).notNull(),
  dedupeKey: varchar("dedupeKey", { length: 255 }).unique(),
});
export const digestDeliveries = mysqlTable("digest_deliveries", {
  id: varchar("id", { length: 64 }).primaryKey(),
  boardId: varchar("boardId", { length: 64 }).notNull(),
  personId: varchar("personId", { length: 64 }).notNull(),
  singaporeDate: varchar("singaporeDate", { length: 10 }).notNull(),
  kind: mysqlEnum("kind", ["manual", "scheduled"]).notNull(),
  notificationId: varchar("notificationId", { length: 64 }).notNull(),
}, table => [uniqueIndex("digest_delivery_once").on(table.boardId, table.personId, table.singaporeDate, table.kind)]);
export const workspaceSchedules = mysqlTable("workspace_schedules", {
  id: varchar("id", { length: 32 }).primaryKey(),
  taskUid: varchar("taskUid", { length: 128 }).unique(),
  status: varchar("status", { length: 32 }).notNull().default("not_configured"),
});
