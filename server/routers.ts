import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { boardSchema, idSchema } from "./workspaceValidation";
import { createBoard, createPerson, getWorkspace, linkPerson, markRead, runBoardDigest, saveBoard } from "./workspaceService";
import { createAIBoard } from "./workspaceAI";
import { ensureWorkspace } from "./workspaceSeed";
import { ensureDigestSchedule } from "./workspaceSchedule";
import { bootstrapPublishedSchedule } from "./scheduleBootstrap";

// A cron ticket authenticates the dedicated callback only, never the user API.
const workspaceProcedure = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx.user as { isCron?: boolean }).isCron) throw new TRPCError({ code: "FORBIDDEN", message: "Scheduled identities cannot use the workspace API." });
  return next();
});
const nonempty = z.string().trim().min(1).max(200);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  workspace: router({
    get: workspaceProcedure.query(async ({ ctx }) => {
      const data = await getWorkspace(ctx.user.id);
      return await bootstrapPublishedSchedule(data) ? getWorkspace(ctx.user.id) : data;
    }),
    saveBoard: workspaceProcedure.input(z.object({ board: boardSchema })).mutation(({ input }) => saveBoard(input.board)),
    createBoard: workspaceProcedure.input(z.object({ name: nonempty })).mutation(({ input }) => createBoard(input.name)),
    createAI: workspaceProcedure.input(z.object({ prompt: z.string().trim().min(1).max(4000) })).mutation(({ input }) => createAIBoard(input.prompt)),
    createPerson: workspaceProcedure.input(z.object({ name: nonempty, role: nonempty })).mutation(({ input }) => createPerson(input.name, input.role)),
    linkPerson: workspaceProcedure.input(z.object({ personId: idSchema })).mutation(({ ctx, input }) => linkPerson(ctx.user.id, input.personId)),
    runDigest: workspaceProcedure.input(z.object({ boardId: idSchema })).mutation(async ({ input }) => { await ensureWorkspace(); return runBoardDigest(input.boardId, "manual"); }),
    markRead: workspaceProcedure.input(z.object({ id: idSchema })).mutation(({ ctx, input }) => markRead(ctx.user.id, input.id)),
    ensureSchedule: workspaceProcedure.input(z.object({ published: z.literal(true) })).mutation(async ({ ctx }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "仅项目所有者可设置定时任务；若未配置 OWNER_OPEN_ID，请在发布后使用所有者环境中的设置命令。" });
      return ensureDigestSchedule();
    }),
  }),
});
export type AppRouter = typeof appRouter;
