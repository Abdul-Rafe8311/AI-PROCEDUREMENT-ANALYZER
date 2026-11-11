// Lets non-React code (fetch helpers) ask the mounted <FeatureLockHost /> to open the locked dialog.
import type { FeatureId } from './entitlements/plans';

type Listener = (feature: FeatureId) => void;
const listeners = new Set<Listener>();

export function onFeatureLock(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function showFeatureLock(feature: FeatureId): void {
  listeners.forEach((l) => l(feature));
}
