import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Board, Person } from "../shared/work";
import { singaporeToday } from "../shared/work";
import { invokeLLM } from "./_core/llm";
import { groupColors, newId, personColors } from "./workspaceSeed";
import { isoDate } from "./workspaceValidation";
import { persistGenerated } from "./workspaceService";

const short = z.string().trim().min(1).max(200);
const proposalSchema = z.object({
  name: short,
  description: z.string().max(4000),
  groups: z.array(z.object({ name: short })).min(2).max(5),
  people: z.array(z.object({ name: short, role: short })).min(3).max(7),
  items: z.array(z.object({ name: short, groupIndex: z.number().int().min(0), assigneeIndex: z.number().int().min(0), status: z.enum(["not_started", "in_progress", "blocked", "review", "done"]), startDate: isoDate, dueDate: isoDate, priority: z.enum(["urgent", "high", "medium", "low"]), notes: z.string().max(4000) })).min(10).max(20),
}).superRefine((data, ctx) => {
  if (new Set(data.people.map(p => p.name.toLocaleLowerCase())).size !== data.people.length) ctx.addIssue({ code: "custom", path: ["people"], message: "Person names must be unique" });
  if (new Set(data.items.map(item => item.name.toLocaleLowerCase())).size !== data.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Task names must be unique" });
  data.items.forEach((item, i) => {
    if (item.groupIndex >= data.groups.length || item.assigneeIndex >= data.people.length) ctx.addIssue({ code: "custom", path: ["items", i], message: "Invalid group or assignee index" });
    if (item.startDate < singaporeToday() || item.dueDate < singaporeToday() || item.dueDate < item.startDate) ctx.addIssue({ code: "custom", path: ["items", i], message: "Dates must be valid, in order, and not before today in Singapore" });
  });
});

function textFromResult(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const error = (result as unknown as { error?: { message?: string } }).error;
  if (error) throw new Error(error.message || "AI service returned an error");
  const content = result.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : Array.isArray(content) ? content.filter(p => p.type === "text").map(p => p.text).join("\n").trim() : "";
}
function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("No JSON object in AI response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export async function createAIBoard(prompt: string): Promise<{ board: Board; people: Person[] }> {
  const today = singaporeToday();
  try {
    const messages = [
      { role: "system" as const, content: `You are a project planner. Return only one JSON object. All text should match the user's language. Include 10 to 20 distinct useful tasks, 2 to 5 groups, and 3 to 7 newly invented people with distinct names and specific roles. Each task has one person. All dates are real YYYY-MM-DD and on or after Singapore today (${today}); startDate must be <= dueDate. Use zero-based integer groupIndex and assigneeIndex referring to the arrays. Use only the enumerated values. Exact shape: {"name":"...","description":"...","groups":[{"name":"..."}],"people":[{"name":"...","role":"..."}],"items":[{"name":"...","groupIndex":0,"assigneeIndex":0,"status":"not_started|in_progress|blocked|review|done","startDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","priority":"urgent|high|medium|low","notes":"..."}]}. Never omit fields.` },
      { role: "user" as const, content: prompt },
    ];
    let result = await invokeLLM({ model: "gpt-6-luna", messages, maxTokens: 12000 });
    let text = textFromResult(result);
    if (!text) {
      result = await invokeLLM({ model: "gpt-6-luna", messages, maxTokens: 12000 });
      text = textFromResult(result);
    }
    if (!text) throw new Error("AI service returned no content");
    const parsed = proposalSchema.parse(parseJson(text));
    const people: Person[] = parsed.people.map((p, i) => ({ id: newId(), name: p.name, role: p.role, color: personColors[i % personColors.length], userId: null }));
    const groups = parsed.groups.map((g, i) => ({ id: newId(), name: g.name, color: groupColors[i % groupColors.length] }));
    const board: Board = {
      id: newId(), name: parsed.name, description: parsed.description, groups, customColumns: [],
      automation: { completionEnabled: true, digestEnabled: false },
      items: parsed.items.map(item => ({ id: newId(), groupId: groups[item.groupIndex].id, name: item.name, status: item.status, assigneeId: people[item.assigneeIndex].id, startDate: item.startDate, dueDate: item.dueDate, priority: item.priority, notes: item.notes, custom: {} })),
    };
    await persistGenerated(board, people);
    return { board, people };
  } catch (error) {
    console.error("[AI board] generation failed:", error);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 看板生成失败或结果不符合要求，请稍后重试。", cause: error });
  }
}
