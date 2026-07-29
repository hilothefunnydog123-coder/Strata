'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { retryJob } from './actions';
import { Button } from '@/components/ui/button';

export function RetryButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await retryJob(jobId);
          router.refresh();
        })
      }
    >
      {pending ? 'Requeueing' : 'Retry'}
    </Button>
  );
}
