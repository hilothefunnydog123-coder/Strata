import { z } from 'zod';

/**
 * The demo request form.
 *
 * Zod at the boundary, shared between the client (for inline errors as she
 * types) and the server action (which never trusts the client's word for it).
 *
 * Error messages are written for the person filling the form, not for a
 * developer reading a log. "Use your work email" is actionable. "Invalid input"
 * is not.
 */

/** Free mailbox domains. A hospital does not run its denials from Gmail. */
const CONSUMER_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'live.com',
  'msn.com',
]);

export const ANNUAL_DENIAL_VOLUMES = [
  'under_500',
  '500_2000',
  '2000_10000',
  'over_10000',
  'not_sure',
] as const;

export const VOLUME_LABELS: Record<(typeof ANNUAL_DENIAL_VOLUMES)[number], string> = {
  under_500: 'Fewer than 500',
  '500_2000': '500 to 2,000',
  '2000_10000': '2,000 to 10,000',
  over_10000: 'More than 10,000',
  not_sure: 'I am not sure',
};

export const demoRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your name.')
    .max(120, 'That is longer than we can store. Use 120 characters or fewer.'),

  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('That does not look like an email address. Check for a typo.')
    .max(254)
    .refine(
      (value) => !CONSUMER_DOMAINS.has(value.split('@')[1] ?? ''),
      'Use your work email so we can tell which organisation you are with.',
    ),

  orgName: z
    .string()
    .trim()
    .min(2, 'Enter the name of your hospital or health system.')
    .max(200),

  title: z
    .string()
    .trim()
    .min(2, 'Enter your job title.')
    .max(120),

  annualDenialVolume: z.enum(ANNUAL_DENIAL_VOLUMES, {
    errorMap: () => ({ message: 'Pick the range closest to your volume.' }),
  }),

  message: z
    .string()
    .trim()
    .max(2000, 'Keep it under 2,000 characters. We will ask for the rest on the call.')
    .optional()
    .or(z.literal('')),

  /**
   * Honeypot. A real person never sees this field and never fills it in, so a
   * value here is a bot. The submission is accepted with a normal looking
   * response and thrown away, because telling a bot it was caught only teaches
   * whoever wrote it to try harder.
   */
  website: z.string().max(0).optional().or(z.literal('')),
});

export type DemoRequestInput = z.infer<typeof demoRequestSchema>;
