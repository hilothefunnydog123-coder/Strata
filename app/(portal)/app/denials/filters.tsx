'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/field';

/**
 * Filters that live in the query string.
 *
 * In the URL rather than in component state, so a filtered view can be sent to
 * a colleague, bookmarked, and reached by the browser's back button. A denials
 * specialist working a queue does all three.
 */
export function Filters({
  payers,
  statuses,
  statusLabels,
  current,
}: {
  payers: string[];
  statuses: string[];
  statusLabels: Record<string, string>;
  current: { status: string; payer: string; deadline: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
  }

  const anyActive = Boolean(current.status || current.payer || current.deadline);

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-xs text-ink-2">
        <span className="block">Stage</span>
        <Select
          className="mt-1 h-7 py-0 text-xs"
          value={current.status}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="">All stages</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </Select>
      </label>

      <label className="text-xs text-ink-2">
        <span className="block">Payer</span>
        <Select
          className="mt-1 h-7 py-0 text-xs"
          value={current.payer}
          onChange={(e) => set('payer', e.target.value)}
        >
          <option value="">All payers</option>
          {payers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </label>

      <label className="text-xs text-ink-2">
        <span className="block">Deadline</span>
        <Select
          className="mt-1 h-7 py-0 text-xs"
          value={current.deadline}
          onChange={(e) => set('deadline', e.target.value)}
        >
          <option value="">Any deadline</option>
          <option value="overdue">Already passed</option>
          <option value="week">Inside 7 days</option>
          <option value="month">Inside 30 days</option>
        </Select>
      </label>

      {anyActive ? (
        <button
          type="button"
          className="h-7 text-xs text-action underline"
          onClick={() => router.push(pathname)}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
