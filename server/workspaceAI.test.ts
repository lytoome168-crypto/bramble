import { beforeEach, describe, expect, it, vi } from "vitest";
import { singaporeToday } from "../shared/work";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), persist: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invoke }));
vi.mock("./workspaceService", () => ({ persistGenerated: mocks.persist }));
import { createAIBoard } from "./workspaceAI";

const response = (content: string) => ({ choices: [{ message: { content } }] });
function proposal() {
  return { name: "测试", description: "计划", groups: [{ name: "准备" }, { name: "执行" }], people: [{ name: "甲", role: "负责人" }, { name: "乙", role: "设计师" }, { name: "丙", role: "工程师" }], items: Array.from({ length: 10 }, (_, i) => ({ name: `任务${i}`, groupIndex: i % 2, assigneeIndex: i % 3, status: "not_started", startDate: singaporeToday(), dueDate: singaporeToday(), priority: "medium", notes: "" })) };
}
beforeEach(() => { vi.clearAllMocks(); mocks.persist.mockResolvedValue(undefined); });
describe("AI validation", () => {
  it("uses the explicitly named model and creates validated people and tasks", async () => {
    mocks.invoke.mockResolvedValue(response(JSON.stringify(proposal())));
    const result = await createAIBoard("项目");
    expect(mocks.invoke.mock.calls[0][0].model).toBe("gpt-6-luna");
    expect(result.board.items).toHaveLength(10);
    expect(result.people).toHaveLength(3);
    expect(result.people.every(person => person.userId === null)).toBe(true);
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
  it("rejects dates in the past before persistence", async () => {
    const p = proposal(); p.items[0].startDate = "2000-01-01";
    mocks.invoke.mockResolvedValue(response(JSON.stringify(p)));
    await expect(createAIBoard("项目")).rejects.toThrow("AI 看板生成失败");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("rejects malformed responses and never writes partial data", async () => {
    mocks.invoke.mockResolvedValue(response("not json"));
    await expect(createAIBoard("项目")).rejects.toThrow("AI 看板生成失败");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("retries an empty output once and accepts a fenced JSON object", async () => {
    mocks.invoke.mockResolvedValueOnce(response("")).mockResolvedValueOnce(response(`\`\`\`json\n${JSON.stringify(proposal())}\n\`\`\``));
    const result = await createAIBoard("项目");
    expect(result.board.items).toHaveLength(10);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});
