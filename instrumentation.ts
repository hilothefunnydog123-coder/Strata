/**
 * Startup checks.
 *
 * Next.js calls register() once per server process before it handles a request.
 * Validating the environment here means a misconfigured deployment fails to
 * start, loudly, rather than serving traffic and failing on whichever page
 * happens to read the missing variable first.
 */
export async function register(): Promise<void> {
  const { assertEnv } = await import('@/lib/env');
  const { log } = await import('@/lib/log');

  const env = assertEnv();

  log.info('server starting', {
    phiMode: env.PHI_MODE,
    storage: env.storageIsR2 ? 'r2' : 'local-disk',
    baaConfirmed: env.ANTHROPIC_BAA_CONFIRMED,
  });

  if (!env.phiLive) {
    log.warn(
      'PHI_MODE is synthetic. This environment is not approved for patient data. ' +
        'Uploads must be tagged synthetic and will be rejected otherwise.',
    );
  }
}
