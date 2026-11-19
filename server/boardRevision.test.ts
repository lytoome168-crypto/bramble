import { describe, expect, it } from 'vitest';
import { demoData } from './workspaceSeed';
import { advanceBoardRevision } from './boardRevision';

describe('board revisions', () => {
  it('increments a legacy board revision and rejects a stale snapshot', () => {
    const { board } = demoData('2026-11-19');
    const saved = advanceBoardRevision(board, { ...board, name: 'Changed' });
    expect(saved.revision).toBe(1);
    expect(() => advanceBoardRevision(saved, board)).toThrow(/其他成员/);
    expect(advanceBoardRevision(saved, { ...saved, name: 'Next' }).revision).toBe(2);
  });
});
