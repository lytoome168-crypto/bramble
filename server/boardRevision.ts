import { TRPCError } from '@trpc/server';
import type { Board } from '../shared/work';

/** Must be called while holding the persisted board's row lock. */
export function advanceBoardRevision(current: Board, incoming: Board): Board {
  const savedRevision = current.revision ?? 0;
  if ((incoming.revision ?? 0) !== savedRevision) {
    throw new TRPCError({ code: 'CONFLICT', message: '看板已被其他成员修改，请加载最新版本后重新操作。' });
  }
  return { ...incoming, revision: savedRevision + 1 };
}
