// Pure rendering for the closed set of transactional emails (AD-10). No I/O.
export const EMAIL_TEMPLATES = ['payment_submitted_admin', 'payment_approved', 'payment_rejected', 'expiry_reminder'] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export type EmailData =
  | { template: 'payment_submitted_admin'; userEmail: string; plan: string; amountUsd: number; adminUrl: string }
  | { template: 'payment_approved'; plan: string; expiresOn: string }
  | { template: 'payment_rejected'; plan: string; reason: string; supportEmail: string | null; plansUrl: string }
  | { template: 'expiry_reminder'; plan: string; expiresOn: string; plansUrl: string };

/** EmailData without the discriminant (Omit would collapse the union). */
export type EmailPayload = EmailData extends infer U ? (U extends EmailData ? Omit<U, 'template'> : never) : never;

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const usd = (n: number) => `$${n.toFixed(2)} USD`;

function wrap(lines: string[], link?: { href: string; label: string }): { text: string; html: string } {
  const text = [...lines, ...(link ? ['', `${link.label}: ${link.href}`] : [])].join('\n');
  const html =
    lines.map((l) => `<p>${esc(l)}</p>`).join('') +
    (link ? `<p><a href="${esc(link.href)}">${esc(link.label)}</a></p>` : '');
  return { text, html };
}

export function renderEmail(d: EmailData): Rendered {
  switch (d.template) {
    case 'payment_submitted_admin': {
      const plan = cap(d.plan);
      const r = wrap(
        [`New payment request from ${d.userEmail}.`, `Plan: ${plan}`, `Amount: ${usd(d.amountUsd)}`],
        { href: d.adminUrl, label: 'Review in the Admin Page' },
      );
      return { subject: `New payment request: ${plan} from ${d.userEmail}`, ...r };
    }
    case 'payment_approved': {
      const plan = cap(d.plan);
      const r = wrap([`Your ${plan} plan is active until ${d.expiresOn}.`, 'Open the workspace to keep going. You do not need to sign in again.']);
      return { subject: `Your ${plan} plan is active`, ...r };
    }
    case 'payment_rejected': {
      const plan = cap(d.plan);
      const lines = [
        `We could not approve your ${plan} payment.`,
        `Reason: ${d.reason}`,
        'You can submit a new request from the Plans page.',
        ...(d.supportEmail ? [`Questions: ${d.supportEmail}`] : []),
      ];
      const r = wrap(lines, { href: d.plansUrl, label: 'Go to Plans' });
      return { subject: `Your ${plan} payment was not approved`, ...r };
    }
    default: {
      const plan = cap(d.plan);
      const r = wrap([`Your ${plan} plan ends on ${d.expiresOn}.`, 'Renew to add 30 more days.'], { href: d.plansUrl, label: 'Renew on the Plans page' });
      return { subject: `Your ${plan} plan ends on ${d.expiresOn}`, ...r };
    }
  }
}
