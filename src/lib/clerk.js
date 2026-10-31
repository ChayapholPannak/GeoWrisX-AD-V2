const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

/** True when a real Clerk publishable key was provided at build time. */
export const isClerkConfigured = Boolean(
  publishableKey && !publishableKey.includes('REPLACE_ME'),
);

export { publishableKey };
