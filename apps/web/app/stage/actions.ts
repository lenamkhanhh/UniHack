'use server';

import { resetArenaForTesting, verifyArenaPresenterKey } from '@/lib/arena';

/**
 * Presenter Reset Action for /stage (WOW-F11 & WOW-F13).
 * Runs strictly on the server: validates the presenter key entered by the presenter
 * against process.env.ARENA_PRESENTER_KEY using constant-time comparison.
 * Zero hardcoded fallback keys; if env key is missing or key does not match, reset is refused.
 */
export async function resetArenaAction(
  presenterKey?: string
): Promise<{ success: boolean; message: string; error?: string }> {
  const check = verifyArenaPresenterKey(presenterKey);
  if (!check.valid) {
    return {
      success: false,
      error: check.error || 'Unauthorized: Invalid presenter key',
      message: 'Reset rejected: unauthorized presenter key.',
    };
  }

  resetArenaForTesting();
  return {
    success: true,
    message: 'Arena sandbox state and budget have been successfully reset to $10.00 initial cap.',
  };
}
