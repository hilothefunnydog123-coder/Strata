/**
 * The one place the product name lives. Working name is "Assent" (trademark
 * unverified per the brief). Change it here and it changes everywhere.
 */
export const PRODUCT = {
  name: "Assent",
  legalName: "Assent, Inc.",
  desktopName: "Assent Desktop",
  tagline: "The queryable specification of US coverage policy.",
  // The single sentence the customer would actually say about her own problem.
  customerTruth:
    "You are about to bet five years and forty million dollars on a guess about what payers will require.",
  domain: "assent.example.com",
  supportEmail: "support@assent.example.com",
  crawlerName: "AssentBot",
} as const;

export type ProductConfig = typeof PRODUCT;
