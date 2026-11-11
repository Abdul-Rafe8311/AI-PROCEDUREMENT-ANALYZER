// Copy and formatting for the Pay step (UX-DR6, UX-DR15). Pure so it is unit-tested.
import { formatQuotaDate } from './entitlements/quota-window';
import { PLAN_RANK, type PlanId } from './entitlements/plans';
import { PLAN_NAMES } from './plan-matrix';

/** "SA0380000000608010167519" -> "SA03 8000 0000 6080 1016 7519". Non-IBAN strings are left alone. */
export function groupIban(value: string): string {
  const compact = value.replace(/\s+/g, '');
  return /^[A-Za-z]{2}\d{2}[A-Za-z0-9]+$/.test(compact) ? compact.replace(/(.{4})/g, '$1 ').trim() : value;
}

export const isIbanKey = (key: string): boolean => key.toLowerCase() === 'iban';

/** The value that is copied: IBANs are copied compact (banks reject spaces in some portals). */
export const copyValue = (key: string, value: string): string => (isIbanKey(key) ? value.replace(/\s+/g, '') : value);

export const displayValue = (key: string, value: string): string => (isIbanKey(key) ? groupIban(value) : value);

export const formatUsd = (amount: number): string => `$${amount.toFixed(2)} USD`;

export const payHeading = (amount: number): string => `Pay ${formatUsd(amount)} by bank transfer`;

export interface DisclosureInput {
  current: PlanId;
  target: PlanId;
  /** end of the user's last current or queued period; null on Free */
  chainEnd: string | null;
}

/** Disclosures shown above the submit area. Empty when moving up from Free. */
export function payDisclosures(i: DisclosureInput): string[] {
  const cur = PLAN_NAMES[i.current];
  const tgt = PLAN_NAMES[i.target];
  if (i.current === 'free') return [];
  if (PLAN_RANK[i.target] > PLAN_RANK[i.current]) {
    return [
      `Upgrading to ${tgt} starts it as soon as we approve your payment, with a fresh PDF allowance. The remaining days of your ${cur} plan are not carried over.`,
    ];
  }
  const date = i.chainEnd ? formatQuotaDate(i.chainEnd) : null;
  if (PLAN_RANK[i.target] === PLAN_RANK[i.current]) {
    return [
      date
        ? `This adds 30 days to ${tgt} after your current period ends on ${date}. Your PDF usage is not reset.`
        : `This adds 30 days to ${tgt}.`,
    ];
  }
  return [
    date
      ? `${tgt} starts on ${date}. You keep ${cur} until then.`
      : `${tgt} starts when your current plan ends. You keep ${cur} until then.`,
  ];
}

export const PAY_STEPS = [
  'Make the transfer using the bank details below.',
  'Upload your receipt and enter the transaction ID.',
  'We review within about 24 hours and email you.',
] as const;

export const refundPolicy = (supportEmail: string | null): string =>
  `Plans are not refundable once activated. If we can't verify your payment, email ${
    supportEmail ?? 'our support address'
  } and we'll refund you manually.`;
