import { expect, it, vi } from "vitest";
import { singaporeToday } from "../shared/work";

vi.mock("./workspaceService", () => ({ persistGenerated: vi.fn(async () => {}) }));
import { createAIBoard } from "./workspaceAI";
import { persistGenerated } from "./workspaceService";

it.skipIf(process.env.RUN_LIVE_LLM_TEST !== "1")("generates and validates a real project plan with gpt-6-luna", async () => {
  const { board, people } = await createAIBoard("为小型团队规划一个社区图书交换活动，包括宣传、报名与现场执行。");
  expect(board.items.length).toBeGreaterThanOrEqual(10);
  expect(board.items.length).toBeLessThanOrEqual(20);
  expect(people.length).toBeGreaterThanOrEqual(3);
  expect(people.every(p => p.name && p.role && p.userId === null)).toBe(true);
  expect(board.items.every(i => i.startDate! >= singaporeToday() && i.dueDate! >= singaporeToday() && i.startDate! <= i.dueDate!)).toBe(true);
  expect(persistGenerated).toHaveBeenCalledOnce();
}, 120_000);
