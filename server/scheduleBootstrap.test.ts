import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoData } from './workspaceSeed';

const schedule = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('./workspaceSchedule', () => ({ ensureDigestSchedule: schedule.ensure }));
import { bootstrapPublishedSchedule } from './scheduleBootstrap';

afterEach(() => { vi.unstubAllEnvs(); });
describe('published schedule bootstrap', () => {
  it('never registers from preview and sets up only an enabled, unconfigured production workspace', async () => {
    const { board, people } = demoData('2026-11-19');
    const data = { boards: [board], people, notifications: [], logs: [] };
    vi.stubEnv('NODE_ENV', 'development');
    expect(await bootstrapPublishedSchedule(data)).toBe(false);
    expect(schedule.ensure).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'production');
    schedule.ensure.mockResolvedValue({ status: 'active' });
    expect(await bootstrapPublishedSchedule(data)).toBe(true);
    expect(schedule.ensure).toHaveBeenCalledTimes(1);
    expect(await bootstrapPublishedSchedule(data)).toBe(false);
    expect(schedule.ensure).toHaveBeenCalledTimes(1);
  });
});
