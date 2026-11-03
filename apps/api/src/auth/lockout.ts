const TURNSTILE_AFTER_FAILURES = 3;
const LOCKOUT_START_FAILURES = 10;
const LOCKOUT_STEP_FAILURES = 5;
const BASE_LOCK_SECONDS = 15 * 60;
const MAX_LOCK_SECONDS = 60 * 60;

export function shouldRequireTurnstile(failures: number): boolean {
  return failures >= TURNSTILE_AFTER_FAILURES;
}

export function loginFailureLockSeconds(failures: number): number {
  if (failures < LOCKOUT_START_FAILURES) return 0;
  const level = Math.floor((failures - LOCKOUT_START_FAILURES) / LOCKOUT_STEP_FAILURES);
  return Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** level);
}
