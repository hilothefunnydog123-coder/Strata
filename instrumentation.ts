/**
 * Startup checks.
 *
 * Next.js calls register() once per server process before it handles a request.
 * Validating the environment here means a misconfigured deployment fails to
 * start, loudly, rather than serving traffic and failing on whichever page
 * happens to read the missing variable first.
 *
 * A deployment with nothing set at all is a different case and is not fatal: it
 * serves its public pages behind a banner saying it is not configured, so that
 * a first deploy can be looked at. The distinction is enforced in envStatus().
 */
export async function register(): Promise<void> {
  const { assertEnv, envStatus } = await import('@/lib/env');
  const { log } = await import('@/lib/log');

  const status = envStatus();
  if (!status.configured) {
    // Deliberately not fatal. A deployment with nothing set is a new one, and
    // it serves its public pages behind a banner saying so. envStatus() has
    // already refused the dangerous shape: a reachable database alongside
    // missing secrets throws rather than degrading.
    log.warn(
      'This deployment is not configured and is serving public pages only. ' +
        `Missing: ${status.missing.join(', ')}.`,
    );
    return;
  }

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

  // The first operator, on a host with no shell to run the script from. Inert
  // unless SUPERADMIN_EMAIL is set and the user table is empty.
  //
  // The runtime check is not defensive style, it is what makes this compile.
  // register() is bundled for the edge runtime as well as node, because this
  // application has middleware, and the database client pulls in pg, which
  // needs fs. Next replaces NEXT_RUNTIME with a literal per bundle, so in the
  // edge bundle this whole branch is eliminated and the import is never
  // followed. It is a build-time constant rather than configuration, which is
  // why it is read here and not through lib/env.ts.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // A failure must not stop the server: an unreachable database at boot is a
    // transient condition on most hosts, and refusing to start turns a slow
    // database into an outage.
    try {
      const { bootstrapFirstOperator } = await import('@/lib/auth/bootstrap');
      const outcome = await bootstrapFirstOperator();
      if (outcome.status === 'created') {
        log.info('first operator account created at startup');
      }
    } catch (error) {
      log.error('could not create the first operator account', { error });
    }
  }
}
