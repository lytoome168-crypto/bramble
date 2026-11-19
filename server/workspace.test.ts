import { describe, expect, it } from "vitest";
import { demoData } from "./workspaceSeed";
import { boardSchema, cleanBoard } from "./workspaceValidation";
import { isOverdue } from "../shared/work";
import { appRouter } from "./routers";

describe("workspace invariants", () => {
  it("creates the requested initial data with exactly three overdue items", () => {
    const { board, people } = demoData("2026-11-19");
    expect(board.name).toBe("Q4 Product Launch");
    expect(board.groups).toHaveLength(4);
    expect(board.items).toHaveLength(18);
    expect(people).toHaveLength(5);
    expect(people.every(p => p.userId === null)).toBe(true);
    expect(board.items.filter(i => isOverdue(i, "2026-11-19"))).toHaveLength(3);
    expect(boardSchema.safeParse(board).success).toBe(true);
  });
  it("removes custom values when a column has been removed", () => {
    const { board } = demoData();
    board.customColumns = [{ id: "keep", name: "Keep", type: "text" }];
    board.items[0].custom = { keep: "yes", removed: "no" };
    expect(cleanBoard(board).items[0].custom).toEqual({ keep: "yes" });
  });
  it("rejects unknown groups, duplicated IDs, and impossible dates", () => {
    const { board } = demoData();
    board.items[0].groupId = "missing";
    board.items[1].id = board.items[0].id;
    board.items[2].dueDate = "2026-02-30";
    expect(boardSchema.safeParse(board).success).toBe(false);
  });
  it("rejects unauthenticated workspace procedures", async () => {
    const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: null });
    await expect(caller.workspace.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.workspace.createPerson({ name: "A", role: "B" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.workspace.runDigest({ boardId: "test" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
