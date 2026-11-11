// Copy and decisions for locked chat / tender-sheet controls (UX-DR3). Pure so it is unit-tested.
import { PLAN_IDS, canUseFeature, featureRequiredPlan, type FeatureId, type PlanId } from './entitlements/plans';
import { planLabel } from './quota-callout';

export interface FeatureLockCopy {
  feature: FeatureId;
  name: string;
  /** "Plus" / "Pro" */
  planName: string;
  benefit: string;
}

const COPY: Record<FeatureId, { name: string; benefit: string }> = {
  chat: { name: 'Chatbox', benefit: 'Ask questions about your quotations and get answers with charts.' },
  tender_sheet: {
    name: 'Tender sheet',
    benefit: 'Build the side-by-side technical comparison sheet and export it to Excel.',
  },
};

export function featureLockCopy(feature: FeatureId): FeatureLockCopy {
  return { feature, ...COPY[feature], planName: planLabel(featureRequiredPlan(feature)) };
}

/** Unknown or missing plan is treated as unlocked: the server's 403 is the real gate. */
export function isFeatureLocked(plan: string | null | undefined, feature: FeatureId): boolean {
  if (!plan || !(PLAN_IDS as readonly string[]).includes(plan)) return false;
  return !canUseFeature(plan as PlanId, feature);
}

/** Parses a 403 PLAN_REQUIRED body by `code` (never message text); null for anything else. */
export function parsePlanRequired(status: number, body: unknown): FeatureId | null {
  const b = body as Record<string, unknown> | null;
  if (status !== 403 || !b || b.code !== 'PLAN_REQUIRED') return null;
  return b.feature === 'chat' || b.feature === 'tender_sheet' ? b.feature : null;
}

export class PlanRequiredError extends Error {
  constructor(public readonly feature: FeatureId) {
    super('PLAN_REQUIRED');
    this.name = 'PlanRequiredError';
  }
}
