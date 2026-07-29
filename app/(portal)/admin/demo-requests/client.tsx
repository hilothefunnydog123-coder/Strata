'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setDemoRequestStatus } from './actions';
import { Select } from '@/components/ui/field';

const STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const;

export function StatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Select
      className="h-7 py-0 text-xs"
      value={status}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setDemoRequestStatus(id, e.target.value);
          router.refresh();
        })
      }
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </Select>
  );
}
