import { ENV } from './_core/env';
import { ensureDigestSchedule } from './workspaceSchedule';
import type { WorkspaceData } from '../shared/work';

// The deployed application receives a real authenticated request only after a
// user opens it. Never register a callback from the development Preview.
let nextAttempt = 0;
let inFlight: Promise<boolean> | null = null;
export async function bootstrapPublishedSchedule(data: WorkspaceData): Promise<boolean> {
  if (!ENV.isProduction || !data.boards.some(b => b.automation.digestEnabled) || data.boards.some(b => b.automation.scheduleStatus === 'active')) return false;
  if (inFlight) return inFlight;
  if (Date.now() < nextAttempt) return false;
  nextAttempt = Date.now() + 5 * 60_000;
  inFlight = ensureDigestSchedule().then(() => true).catch(error => {
    console.warn('[Digest] Post-publication schedule setup failed; will retry later:', error instanceof Error ? error.message : String(error));
    return false;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
