// Password rules for sign-up. Supabase hashes + stores the password (bcrypt) — we
// NEVER store or log plaintext. This module only decides, client-side, whether a
// chosen password is strong enough to submit, and renders a friendly strength meter.
// Supabase enforces its own minimum server-side too; this is the UX guard.

export const MIN_PASSWORD_LENGTH = 8;

export type StrengthLabel = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordAssessment {
  /** true when the password clears the minimum bar to submit */
  ok: boolean;
  /** 0–4 strength score */
  score: number;
  label: StrengthLabel;
  /** human-readable reasons it's not yet acceptable / could be stronger */
  issues: string[];
}

/**
 * Basic strength check: length + variety (lower, upper, digit, symbol). We require
 * at least MIN_PASSWORD_LENGTH characters AND a score of ≥2 (i.e. more than just
 * lowercase letters) to submit — enough to stop "password"/"12345678" without
 * frustrating Farid with maximal-entropy rules.
 */
export function assessPassword(pw: string): PasswordAssessment {
  const issues: string[] = [];
  const len = pw.length;

  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const variety = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  if (len < MIN_PASSWORD_LENGTH) {
    issues.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (variety < 2) {
    issues.push('Mix letters with numbers or symbols');
  }

  // Score: 1 point for meeting length, +1 per character class beyond the first,
  // bonus for a longer password. Clamped to 0–4.
  let score = 0;
  if (len >= MIN_PASSWORD_LENGTH) score += 1;
  score += Math.max(0, variety - 1);
  if (len >= 12) score += 1;
  score = Math.min(4, score);

  // A password that fails the hard requirements can't score above 1.
  const meetsHardRules = len >= MIN_PASSWORD_LENGTH && variety >= 2;
  if (!meetsHardRules) score = Math.min(score, 1);

  const label: StrengthLabel = score <= 1 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';

  return { ok: meetsHardRules, score, label, issues };
}
