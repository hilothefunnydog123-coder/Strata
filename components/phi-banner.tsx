import { env } from '@/lib/env';

/**
 * Compliance requirement 4.
 *
 * While PHI_MODE is synthetic, every authenticated surface says so, in a bar
 * that is part of the page rather than a dismissible toast. Someone who sits
 * down at this application should not be able to reach a screen where they
 * could mistake it for an environment approved to hold patient records.
 *
 * In live mode the bar is absent, because a permanent banner nobody can act on
 * is a banner people stop reading.
 */
export function PhiBanner() {
  if (env.phiLive) return null;

  return (
    <div
      role="status"
      className="border-b border-denied/40 bg-denied-wash px-4 py-1.5 text-center text-xs text-ink"
    >
      <span className="font-semibold text-denied">Synthetic data only.</span>{' '}
      This environment is not approved for patient information. Uploads must be
      tagged synthetic and anything untagged is rejected.
    </div>
  );
}
