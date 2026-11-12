'use client';

// Shared building blocks for the sign-in / sign-up / password-reset screens: a labelled field with an
// inline error, a password input with show/hide, a form-level alert and a loading submit button.
// Visual tokens only (indigo primary, Inter); every control is at least 44 px tall.
import { useId, useState, type ReactNode } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, type InputProps } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const authInputClass = 'h-11 text-base sm:text-sm';

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 text-pretty text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

interface FieldProps extends Omit<InputProps, 'id'> {
  id: string;
  label: string;
  error?: string | null;
  /** rendered on the label row, right-aligned (e.g. "Forgot password?") */
  labelAction?: ReactNode;
}

export function Field({ id, label, error, labelAction, className, ...props }: FieldProps) {
  const errId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className={cn(authInputClass, error && 'border-destructive focus-visible:ring-destructive', className)}
        {...props}
      />
      {error && (
        <p id={errId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordField({
  id,
  label,
  error,
  labelAction,
  children,
  className,
  ...props
}: FieldProps & { children?: ReactNode }) {
  const [shown, setShown] = useState(false);
  const errId = `${id}-error`;
  const toggleId = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={shown ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={cn(authInputClass, 'pr-12', error && 'border-destructive focus-visible:ring-destructive', className)}
          {...props}
        />
        <button
          id={toggleId}
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {error && (
        <p id={errId} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

export function SubmitButton({
  busy,
  disabled,
  children,
  busyLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  children: ReactNode;
  busyLabel: string;
}) {
  return (
    <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || disabled} aria-busy={busy}>
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Plain-text link styled for the auth screens, with a 44 px hit area. */
export const authLinkClass =
  'inline-flex min-h-[44px] items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';
