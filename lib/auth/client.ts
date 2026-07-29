'use client';

/**
 * Browser side auth client.
 *
 * Used by the sign in form, the two-factor challenge, and enrolment. Everything
 * else, including every authorisation decision, happens on the server.
 */
import { createAuthClient } from 'better-auth/react';
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    twoFactorClient({
      // Send the user to the challenge page when a password alone is not enough.
      onTwoFactorRedirect() {
        window.location.href = '/sign-in/two-factor';
      },
    }),
  ],
});

export const { signIn, signOut, useSession, twoFactor } = authClient;
