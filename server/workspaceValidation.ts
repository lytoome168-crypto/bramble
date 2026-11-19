import { z } from "zod";
import type { Board } from "../shared/work";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const label = z.string().trim().min(1).max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}, "Invalid date");
export const boardSchema = z.object({
  id, revision: z.number().int().nonnegative().optional(), name: label, description: z.string().max(4000),
  groups: z.array(z.object({ id, name: label, color: z.string().min(1).max(40), collapsed: z.boolean().optional() })).max(100),
  items: z.array(z.object({
    id, groupId: id, name: label, status: z.enum(["not_started", "in_progress", "blocked", "review", "done"]),
    assigneeId: id.nullable(), startDate: isoDate.nullable(), dueDate: isoDate.nullable(),
    priority: z.enum(["urgent", "high", "medium", "low"]), notes: z.string().max(10000),
    custom: z.record(z.string().max(64), z.union([z.string().max(4000), z.number().finite(), z.null()])),
  })).max(2000),
  customColumns: z.array(z.object({ id, name: label, type: z.enum(["text", "number", "date", "status", "person"]), options: z.array(z.object({ id, label, color: z.string().max(40) })).max(100).optional() })).max(100),
  automation: z.object({ completionEnabled: z.boolean(), digestEnabled: z.boolean(), scheduleStatus: z.string().max(100).optional() }),
}).superRefine((board, ctx) => {
  for (const [name, values] of [["groups", board.groups], ["items", board.items], ["customColumns", board.customColumns]] as const) {
    if (new Set(values.map(v => v.id)).size !== values.length) ctx.addIssue({ code: "custom", path: [name], message: `Duplicate ${name} IDs` });
  }
  const groups = new Set(board.groups.map(g => g.id));
  board.items.forEach((item, i) => {
    if (!groups.has(item.groupId)) ctx.addIssue({ code: "custom", path: ["items", i, "groupId"], message: "Group does not exist" });
    if (item.startDate && item.dueDate && item.startDate > item.dueDate) ctx.addIssue({ code: "custom", path: ["items", i, "dueDate"], message: "Due date is before start date" });
  });
});

/** Remove values belonging to columns removed from the board. */
export function cleanBoard(board: Board): Board {
  const allowed = new Set(board.customColumns.map(c => c.id));
  const { scheduleStatus: _ignored, ...automation } = board.automation;
  return { ...board, automation, items: board.items.map(item => ({ ...item, custom: Object.fromEntries(Object.entries(item.custom).filter(([key]) => allowed.has(key))) })) };
}
export { id as idSchema, isoDate };
