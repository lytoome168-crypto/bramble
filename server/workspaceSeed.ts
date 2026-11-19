import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import type { Board, Person, WorkItem } from "../shared/work";
import { singaporeToday } from "../shared/work";
import { workspaceBoards, workspaceMeta, workspacePeople } from "../drizzle/schema";
import { getDb } from "./db";

export const personColors = ["#719b85", "#c7896b", "#879bc1", "#ba91aa", "#c3a365", "#83aeb4", "#a591c3"];
export const groupColors = ["#8eb59d", "#d9b67d", "#95a9cc", "#c79eae"];
export const newId = () => nanoid();
export function dateOffset(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function demoData(today = singaporeToday()): { board: Board; people: Person[] } {
  const names = [["林晓", "项目负责人"], ["陈静", "设计师"], ["王明", "开发工程师"], ["李娜", "产品经理"], ["周宇", "运营专员"]];
  const people = names.map(([name, role], i) => ({ id: newId(), name, role, color: personColors[i], userId: null }));
  const groups = ["项目规划", "设计与体验", "开发执行", "发布与复盘"].map((name, i) => ({ id: newId(), name, color: groupColors[i] }));
  const taskNames = [
    ["明确项目目标", "梳理需求与范围", "制定项目里程碑", "确认利益相关方", "整理项目风险"],
    ["用户研究访谈", "绘制用户流程", "完成低保真原型", "设计视觉规范", "评审交互细节"],
    ["搭建开发环境", "实现核心功能", "对接数据接口", "编写自动化测试", "修复关键问题"],
    ["准备发布清单", "内部验收测试", "整理使用文档"]
  ];
  const items: WorkItem[] = [];
  let index = 0;
  for (const [groupIndex, tasks] of taskNames.entries()) {
    for (const name of tasks) {
      const due = index - 3;
      items.push({ id: newId(), groupId: groups[groupIndex].id, name, status: index < 3 ? ["in_progress", "blocked", "not_started"][index] as WorkItem["status"] : (["not_started", "in_progress", "review", "done"] as const)[index % 4], assigneeId: people[index % people.length].id, startDate: dateOffset(today, due - 5), dueDate: dateOffset(today, due), priority: (["high", "medium", "low", "urgent"] as const)[index % 4], notes: "", custom: {} });
      index++;
    }
  }
  return { people, board: { id: newId(), name: "Q4 Product Launch", description: "一起规划、跟进并交付重要工作。", groups, items, customColumns: [], automation: { completionEnabled: true, digestEnabled: true } } };
}

/** Transactional seed marker prevents duplicate seeds and never overwrites edits. */
export async function ensureWorkspace(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.transaction(async tx => {
    await tx.insert(workspaceMeta).values({ id: "shared", seeded: 0 }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
    const [meta] = await tx.select().from(workspaceMeta).where(eq(workspaceMeta.id, "shared")).for("update");
    if (meta.seeded) return;
    const { board, people } = demoData();
    await tx.insert(workspacePeople).values(people.map(person => ({ id: person.id, data: person })));
    await tx.insert(workspaceBoards).values({ id: board.id, data: board });
    await tx.update(workspaceMeta).set({ seeded: 1 }).where(eq(workspaceMeta.id, "shared"));
  });
}
