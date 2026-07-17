'use client';

import { assessPassword } from '@/lib/password';
import { cn } from '@/lib/utils';

// Live strength meter shown under the password field on sign-up / reset. Four
// segments fill by score; unmet requirements are listed beneath.
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const { score, label, issues } = assessPassword(password);

  const barColor =
    score <= 1 ? 'bg-destructive' : score === 2 ? 'bg-warning' : score === 3 ? 'bg-primary' : 'bg-success';
  const textColor =
    score <= 1 ? 'text-destructive' : score === 2 ? 'text-warning' : score === 3 ? 'text-primary' : 'text-success';

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn('h-1 flex-1 rounded-full transition-colors', i < score ? barColor : 'bg-muted')}
            />
          ))}
        </div>
        <span className={cn('text-xs font-medium capitalize', textColor)}>{label}</span>
      </div>
      {issues.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {issues.map((i) => (
            <li key={i}>• {i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
