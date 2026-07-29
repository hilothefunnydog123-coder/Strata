import Link from 'next/link';

/**
 * The small pieces that appear on nearly every screen.
 *
 * Colour rule, applied without exception: denied red for money withheld and
 * work at risk, recovered green for money returned and work approved, action
 * blue for things you can click. No fourth meaning gets a colour.
 */

/* ─── Money and figures ───────────────────────────────────────────────────── */

export type MoneyTone = 'neutral' | 'denied' | 'recovered';

const MONEY_TONE: Record<MoneyTone, string> = {
  neutral: 'text-ink',
  denied: 'text-denied',
  recovered: 'text-recovered',
};

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Whole dollars, for figures large enough that cents are noise. */
export function formatDollars(cents: number): string {
  return Math.round(cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function Money({
  cents,
  tone = 'neutral',
  whole = false,
  className = '',
}: {
  cents: number;
  tone?: MoneyTone;
  whole?: boolean;
  className?: string;
}) {
  return (
    <span className={`tnum ${MONEY_TONE[tone]} ${className}`}>
      {whole ? formatDollars(cents) : formatCents(cents)}
    </span>
  );
}

/** An identifier: claim number, citation, CFR reference, denial code. */
export function Id({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`id text-[0.8125rem] ${className}`}>{children}</span>;
}

/* ─── Status ──────────────────────────────────────────────────────────────── */

export type Tone = 'neutral' | 'denied' | 'recovered' | 'action';

const TAG_TONE: Record<Tone, string> = {
  neutral: 'border-rule-strong bg-paper-sunk text-ink',
  denied: 'border-denied/40 bg-denied-wash text-denied',
  recovered: 'border-recovered/40 bg-recovered-wash text-recovered',
  action: 'border-action/40 bg-action-wash text-action',
};

export function Tag({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide ${TAG_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ─── Layout ──────────────────────────────────────────────────────────────── */

/**
 * A panel: a bordered rectangle on paper. Not a floating card, not a shadow,
 * not a rounded box on grey. Documents and tables sit inside these.
 */
export function Panel({
  children,
  className = '',
  as: As = 'section',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return (
    <As className={`border border-rule bg-paper-2 ${className}`}>{children}</As>
  );
}

export function PanelHeader({
  title,
  children,
  className = '',
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-rule bg-paper px-3 py-2 ${className}`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
        {title}
      </h2>
      {children}
    </div>
  );
}

/* ─── States ──────────────────────────────────────────────────────────────── */

/**
 * An empty state names what is not there and what to do about it. It never says
 * "nothing to see here", and it never invents a number to fill the space.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-2">{body}</p>
      {action ? (
        <p className="mt-4">
          <Link href={action.href} className="text-sm font-medium">
            {action.label}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="alert"
      className="border border-denied/40 bg-denied-wash px-4 py-3 text-sm"
    >
      <p className="font-semibold text-denied">{title}</p>
      <p className="mt-1 text-ink">{body}</p>
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className={`border px-3 py-2 text-sm ${TAG_TONE[tone]}`}>{children}</div>
  );
}

/* ─── Tables ──────────────────────────────────────────────────────────────── */

/**
 * Dense by design. The user works this queue for eight hours; more rows on
 * screen is the feature, and whitespace is what costs them scrolling.
 */
export function Table({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  className = '',
  numeric = false,
  scope = 'col',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope={scope}
      className={`border-b border-rule-strong bg-paper px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider text-ink ${
        numeric ? 'text-right' : 'text-left'
      } ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  numeric = false,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={`border-b border-rule px-2.5 py-1.5 align-top ${
        numeric ? 'tnum text-right' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}
