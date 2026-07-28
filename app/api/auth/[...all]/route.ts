import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);

// better-auth needs the Node runtime: it reaches the database on every session
// lookup and uses Node's crypto for password hashing and TOTP.
export const runtime = 'nodejs';
