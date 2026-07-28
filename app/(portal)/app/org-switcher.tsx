'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Membership } from '@/lib/auth/guards';
import { Select } from '@/components/ui/field';

/**
 * Which organisation the portal is showing.
 *
 * Most users belong to one hospital and never see this control. It appears only
 * when there is a genuine choice to make, and the choice travels in the query
 * string so a link to a case is unambiguous about which organisation it means.
 */
export function OrgSwitcher({ memberships }: { memberships: Membership[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (memberships.length <= 1) {
    return memberships[0] ? (
      <span className="hidden text-xs text-ink-2 md:inline">
        {memberships[0].organizationName}
      </span>
    ) : null;
  }

  const current = params.get('org') ?? memberships[0]!.organizationId;

  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-2">
      <span className="sr-only">Organisation</span>
      <Select
        className="h-7 py-0 text-xs"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('org', e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName}
          </option>
        ))}
      </Select>
    </label>
  );
}
