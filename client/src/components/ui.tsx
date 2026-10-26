import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import clsx from 'clsx';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import type { IncidentStatus, Severity } from '@opspilot/shared';
import { ApiError } from '../lib/api';
import { initials, label } from '../lib/format';

/* ------------------------------ buttons ------------------------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90 border-transparent',
  secondary: 'bg-surface text-ink border-line hover:bg-sunken',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-sunken',
  danger: 'bg-crit text-white border-transparent hover:bg-crit/90',
};
const base =
  'inline-flex items-center justify-center gap-2 rounded border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }
>(({ variant = 'secondary', loading, size = 'md', className, children, disabled, type = 'button', ...rest }, ref) => (
  <button
    ref={ref}
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={clsx(base, variants[variant], size === 'sm' && 'px-2.5 py-1.5 text-xs', className)}
    {...rest}
  >
    {loading && <Loader2 size={15} className="animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

export function ButtonLink({ variant = 'secondary', className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={clsx(base, variants[variant], className)} {...rest} />;
}

/* ------------------------------- fields ------------------------------- */
interface FieldShell {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}
function Shell({ label: text, error, hint, required, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {text}
        {required && <span className="text-crit"> *</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-crit">
          {error}
        </p>
      )}
    </div>
  );
}
const aria = (id: string, error?: string, hint?: string) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
});

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldShell>(
  ({ label: l, error, hint, required, className, ...rest }, ref) => {
    const id = useId();
    return (
      <Shell id={id} label={l} error={error} hint={hint} required={required}>
        <input ref={ref} id={id} required={required} className={clsx('input', className)} {...aria(id, error, hint)} {...rest} />
      </Shell>
    );
  },
);
TextField.displayName = 'TextField';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShell>(
  ({ label: l, error, hint, required, className, ...rest }, ref) => {
    const id = useId();
    return (
      <Shell id={id} label={l} error={error} hint={hint} required={required}>
        <textarea ref={ref} id={id} required={required} className={clsx('input min-h-[7rem] resize-y', className)} {...aria(id, error, hint)} {...rest} />
      </Shell>
    );
  },
);
TextArea.displayName = 'TextArea';

export function SelectField({
  label: l,
  error,
  hint,
  required,
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & FieldShell & { options: Array<{ value: string; label: string }> }) {
  const id = useId();
  return (
    <Shell id={id} label={l} error={error} hint={hint} required={required}>
      <select id={id} required={required} className={clsx('input', className)} {...aria(id, error, hint)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/** Compact select for filter bars: visually labelled by its first option, accessibly by aria-label. */
export function FilterSelect({
  label: l,
  options,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: Array<{ value: string; label: string }> }) {
  return (
    <select aria-label={l} className={clsx('input w-auto min-w-[8.5rem] py-1.5 text-sm', className)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------- badges -------------------------------- */
const sevStyle: Record<Severity, string> = {
  critical: 'bg-crit/12 text-crit',
  high: 'bg-high/14 text-high',
  medium: 'bg-med/12 text-med',
  low: 'bg-low/14 text-low',
};
export const sevBar: Record<Severity, string> = { critical: 'bg-crit', high: 'bg-high', medium: 'bg-med', low: 'bg-low' };
export const sevText: Record<Severity, string> = { critical: 'text-crit', high: 'text-high', medium: 'text-med', low: 'text-low' };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold', sevStyle[severity])}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', sevBar[severity])} aria-hidden />
      {label(severity)}
    </span>
  );
}

const statusStyle: Record<IncidentStatus, string> = {
  open: 'border-ink/40 text-ink',
  triaged: 'border-med/50 text-med',
  in_progress: 'border-accent/60 text-accent',
  blocked: 'border-high/60 text-high',
  resolved: 'border-ok/60 text-ok',
  closed: 'border-line text-muted',
};
export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span className={clsx('inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium', statusStyle[status])}>
      {label(status)}
    </span>
  );
}

export function PriorityText({ priority }: { priority: string }) {
  return <span className={clsx('text-sm', priority === 'urgent' ? 'font-semibold text-crit' : priority === 'high' ? 'font-medium text-high' : 'text-muted')}>{label(priority)}</span>;
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-sunken font-semibold text-ink"
    >
      {initials(name)}
    </span>
  );
}

/* ---------------------------- states & layout --------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 text-muted">{icon ?? <Inbox size={28} aria-hidden />}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <AlertCircle className="mb-3 text-crit" size={28} aria-hidden />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded border border-crit/40 bg-crit/8 px-3 py-2 text-sm text-crit">
      {errorMessage(error)}
    </p>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">
        {total} result{total === 1 ? '' : 's'} · page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={14} /> Previous
        </Button>
        <Button size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight size={14} />
        </Button>
      </div>
    </nav>
  );
}

/* -------------------------------- dialog -------------------------------- */
export function Dialog({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx('m-auto w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
          <X size={18} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  loading,
  danger = true,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <div className="text-sm text-muted">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: string; count?: number }> }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
