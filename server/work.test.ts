import { describe, expect, it } from 'vitest';
import { isOverdue, type WorkItem } from '../shared/work';

const item: WorkItem = { id:'i', groupId:'g', name:'Task', status:'in_progress', assigneeId:null, startDate:null, dueDate:'2026-11-18', priority:'medium', notes:'', custom:{} };

describe('overdue status', () => {
  it('marks unfinished work before today as overdue', () => expect(isOverdue(item, '2026-11-19')).toBe(true));
  it('does not mark work due today as overdue', () => expect(isOverdue({...item, dueDate:'2026-11-19'}, '2026-11-19')).toBe(false));
  it('never marks completed or undated work overdue', () => {
    expect(isOverdue({...item, status:'done'}, '2026-11-19')).toBe(false);
    expect(isOverdue({...item, dueDate:null}, '2026-11-19')).toBe(false);
  });
});
