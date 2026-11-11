// Single definition of the plan matrix (AD-3). Pure: no I/O, env or clock.
export const PLAN_IDS = ['free', 'plus', 'pro', 'max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PaidPlanId = Exclude<PlanId, 'free'>;

export const PLAN_RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2, max: 3 };

export const PLAN_QUOTA: Record<PlanId, number> = { free: 14, plus: 30, pro: 45, max: 100 };

export const planRank = (p: PlanId): number => PLAN_RANK[p];
export const planQuota = (p: PlanId): number => PLAN_QUOTA[p];
export const hasChatAccess = (p: PlanId): boolean => PLAN_RANK[p] >= PLAN_RANK.plus;
export const hasTenderSheetAccess = (p: PlanId): boolean => PLAN_RANK[p] >= PLAN_RANK.pro;
