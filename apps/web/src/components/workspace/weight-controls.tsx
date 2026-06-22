'use client';

import { SlidersHorizontal } from 'lucide-react';
import type { ScoreWeights } from '@/lib/workspace-types';

const SLIDERS: { key: keyof ScoreWeights; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'risk', label: 'Risk' },
];

export function WeightControls({
  weights,
  onChange,
}: {
  weights: ScoreWeights;
  onChange: (w: ScoreWeights) => void;
}) {
  const total =
    weights.price + weights.delivery + weights.warranty + weights.risk || 1;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        Scoring weights
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Adjust what matters most — the ranking and &ldquo;Best Overall&rdquo; update live.
        Weights are normalized to 100%.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {SLIDERS.map(({ key, label }) => {
          const pct = Math.round((weights[key] / total) * 100);
          return (
            <label key={key} className="block">
              <span className="mb-1 flex items-center justify-between text-xs font-medium">
                <span>{label}</span>
                <span className="tabular-nums text-primary">{pct}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weights[key]}
                onChange={(e) => onChange({ ...weights, [key]: parseFloat(e.target.value) })}
                className="w-full cursor-pointer accent-[hsl(var(--primary))]"
                aria-label={`${label} weight`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
