/**
 * Placeholder substitution and the campaign footer.
 *
 * Pure text, no database, no environment beyond APP_URL and MAILING_ADDRESS.
 * Separated from lib/email/campaign.ts because the composer runs in the browser
 * and needs a live preview: importing it from the module that also opens a
 * database connection would drag the Postgres driver into the client bundle,
 * which is both a build failure and a thing that should never have been close
 * to happening.
 */
import { env } from '@/lib/env';

export interface Substitutable {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  orgName: string | null;
  email: string;
  unsubscribeToken: string;
}

/**
 * Fill the placeholders.
 *
 * An unfilled placeholder gets a neutral fallback rather than being left as
 * `{{first_name}}` in a real person's inbox, which is the single most
 * recognisable sign of a badly run mail merge. An unknown placeholder is left
 * alone rather than guessed at, so a mistake shows up in the preview.
 */
export function substitute(template: string, target: Substitutable): string {
  const values: Record<string, string> = {
    first_name: target.firstName?.trim() || 'there',
    last_name: target.lastName?.trim() || '',
    title: target.title?.trim() || 'your role',
    org_name: target.orgName?.trim() || 'your organisation',
    email: target.email,
  };

  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : value;
  });
}

/** The placeholders a template uses, for the composer to show. */
export function placeholdersIn(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function unsubscribeUrl(token: string): string {
  return `${env.APP_URL}/unsubscribe/${token}`;
}

/**
 * The footer every campaign message carries.
 *
 * Not optional, not configurable, and appended by this function rather than
 * typed into the template, so a composer who forgets it still sends a compliant
 * message. CAN-SPAM requires both the unsubscribe link and the postal address.
 */
export function campaignFooter(target: Substitutable): string {
  return [
    '',
    '',
    '---',
    `To stop receiving these, unsubscribe here: ${unsubscribeUrl(target.unsubscribeToken)}`,
    env.MAILING_ADDRESS ?? '',
  ].join('\n');
}
