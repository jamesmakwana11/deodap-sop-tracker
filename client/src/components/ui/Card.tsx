import type { ReactNode } from 'react';

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(20,48,107,0.04)] ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-navy">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
