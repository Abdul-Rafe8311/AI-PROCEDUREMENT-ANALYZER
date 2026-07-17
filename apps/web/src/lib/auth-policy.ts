// ── Sign-up domain policy — the ONE place to restrict who can create an account ──
//
// Right now ANY email may sign up. To later lock sign-up to the company domain,
// set ALLOWED_SIGNUP_DOMAIN to that domain (e.g. 'yourcompany.com'). That single
// change makes `isEmailAllowedToSignUp` reject every other address, and the sign-up
// form shows the restriction message. No other code needs to change.
//
// TODO(company-domain): flip this from null to the company's email domain to restrict sign-up.
export const ALLOWED_SIGNUP_DOMAIN: string | null = null;

/** True when `email` may create an account under the current policy. */
export function isEmailAllowedToSignUp(email: string): boolean {
  if (!ALLOWED_SIGNUP_DOMAIN) return true; // open sign-up (current default)
  const at = email.trim().toLowerCase();
  return at.endsWith('@' + ALLOWED_SIGNUP_DOMAIN.toLowerCase());
}

/** Message shown when a restricted domain rejects an address (only used once restricted). */
export function signUpDomainRejectionMessage(): string {
  return ALLOWED_SIGNUP_DOMAIN
    ? `Sign-up is restricted to @${ALLOWED_SIGNUP_DOMAIN} email addresses.`
    : '';
}
