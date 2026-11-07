import { useState } from 'react';

/** A read-only value with a Copy button (falls back to selecting the text when the clipboard is blocked). */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');
  const id = `copy-${label.replace(/\W+/g, '-').toLowerCase()}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.select();
      setState('select');
    }
    setTimeout(() => setState('idle'), 2500);
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <input
        id={id}
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 font-mono text-[13px] text-ink outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={() => void copy()}
        className="h-9 shrink-0 rounded-lg bg-white px-3.5 text-[14px] font-semibold text-navy ring-1 ring-line hover:bg-head/60"
      >
        {state === 'copied' ? 'Copied' : state === 'select' ? 'Press Ctrl+C' : 'Copy'}
      </button>
    </div>
  );
}
