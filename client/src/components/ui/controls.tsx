import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Small set of form controls in the tracker's style. */

const FIELD =
  'h-9 rounded-lg border border-line bg-white px-3 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[12px]">{hint}</span>}
    </label>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} pr-8 ${props.className ?? ''}`} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${props.className ?? ''}`} />;
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-[#1d4fd8] disabled:bg-brand/50',
  secondary: 'bg-white text-navy ring-1 ring-line hover:bg-head/60 disabled:text-muted',
  danger: 'bg-white text-bad ring-1 ring-bad/40 hover:bg-bad hover:text-white',
  ghost: 'text-brand hover:bg-head/60',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info' | 'warn'; children: ReactNode }) {
  const cls = {
    error: 'border-bad/40 bg-bad-bg text-bad',
    success: 'border-good/40 bg-good-bg text-good',
    info: 'border-line bg-head/60 text-ink',
    warn: 'border-avg/40 bg-avg-bg text-avg',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-2.5 text-[14px] ${cls}`}>
      {children}
    </div>
  );
}

export function Pill({ text, bg, children }: { text: string; bg: string; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${text} ${bg}`}>{children}</span>;
}
