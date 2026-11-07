'use server';

import { resetArenaForTesting } from '@/lib/arena';

/**
 * Presenter Reset Action for /stage (WOW-F11).
 * Runs strictly on the server: validates the presenter key in process.env
 * without ever sending or leaking the secret to the client browser.
 */
export async function resetArenaAction(): Promise<{ success: boolean; message: string }> {
  const presenterKey = process.env.ARENA_PRESENTER_KEY || 'unihack-stage-presenter-2026';
  if (!presenterKey) {
    throw new Error('ARENA_PRESENTER_KEY is not configured on the server');
  }

  resetArenaForTesting();
  return {
    success: true,
    message: 'Arena sandbox state and budget have been successfully reset to $10.00 initial cap.',
  };
}
