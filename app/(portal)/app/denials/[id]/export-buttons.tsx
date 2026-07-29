'use client';

import { useState, useTransition } from 'react';
import { exportAppeal, type ExportFormat } from './actions';
import { Button } from '@/components/ui/button';

/**
 * Export is blocked until both reviews approve. The disabled state here is a
 * courtesy; the control is canExport() on the server, which the action calls
 * before it generates anything.
 */
export function ExportButtons({
  denialId,
  draftId,
  enabled,
}: {
  denialId: string;
  draftId: string;
  enabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function download(format: ExportFormat) {
    start(async () => {
      setError(null);
      const result = await exportAppeal(denialId, draftId, format);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }

      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="relative flex items-center gap-2">
      <Button size="sm" disabled={!enabled || pending} onClick={() => download('docx')}>
        Export DOCX
      </Button>
      <Button size="sm" disabled={!enabled || pending} onClick={() => download('pdf')}>
        Export PDF
      </Button>
      {!enabled ? (
        <span className="text-xs text-ink-2">Both reviews must approve first</span>
      ) : null}
      {error ? (
        <p className="absolute right-0 top-9 z-10 w-80 border border-denied/40 bg-denied-wash px-3 py-2 text-xs text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
