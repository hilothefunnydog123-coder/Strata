/**
 * The application logger.
 *
 * Every value passed in goes through redact() before it is serialised, so there
 * is no call path that writes patient content to stdout. Use this instead of
 * console.* anywhere in the codebase; the no-console lint rule enforces it.
 */
import { redact, redactString } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Deliberately not read through lib/env.ts: the logger must work during env
// parsing itself, including when reporting that parsing failed.
const MIN_LEVEL: LogLevel =
  process.env.NODE_ENV === 'production' ? 'info' : 'debug';

export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const line: Record<string, unknown> = {
    level,
    at: new Date().toISOString(),
    msg: redactString(message),
  };

  if (context) {
    // redact() applies key-name filtering to the top level of this object too,
    // so a caller writing log.info('x', { notes }) still gets it stripped.
    Object.assign(line, redact(context) as Record<string, unknown>);
  }

  const serialised = JSON.stringify(line);

  // The single sanctioned console call in the codebase. Everything reaching it
  // has already been redacted above.
  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

export const log = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};
