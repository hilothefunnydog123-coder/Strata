/**
 * The one place the two database drivers disagree.
 *
 * lib/db/index.ts casts the Neon HTTP driver to the node-postgres type so that
 * hundreds of call sites do not each need a cast. The two are identical in use
 * except for interactive transactions, which Neon HTTP does not have: it throws
 * "No transactions support in neon-http driver" the moment one is opened.
 *
 * That difference used to be a sentence in a comment saying the codebase did
 * not use transactions. It was true when written, stopped being true later, and
 * nothing caught it. The cast had already told the type checker a transaction
 * was available, the local and CI databases are node-postgres where it really
 * is, and the whole test suite passed. It failed in production, against the
 * only driver that runs there.
 *
 * A test suite that runs on one driver cannot catch this by exercising code. So
 * the guard is the type (Client omits `transaction`, making db.transaction a
 * compile error) and this file checks the guard is still in place, rather than
 * checking the behaviour it protects.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { db } from '@/lib/db';

const source = readFileSync('lib/db/index.ts', 'utf8');

describe('the database client surface', () => {
  it('omits transaction from the exported type', () => {
    // The compile time guard. If someone widens Client back to the full
    // NodePgDatabase, db.transaction(...) silently becomes writable again and
    // the next person to reach for it gets a production outage rather than a
    // red squiggle.
    expect(source).toContain("Omit<NodePgDatabase<typeof schema>, 'transaction'>");
  });

  it('has no interactive transaction in use anywhere', () => {
    // Belt and braces for the case where the type is widened and this file's
    // first assertion is updated along with it. Both would have to be defeated
    // deliberately.
    const used = ['app', 'lib', 'scripts'].flatMap((dir) => filesUnder(dir));
    const offenders = used.filter((file) =>
      // Comments stripped first: the type in lib/db/index.ts is documented by
      // naming the call it forbids, and a check that trips over its own
      // documentation gets deleted rather than fixed.
      /\bdb\.transaction\s*\(/.test(withoutComments(readFileSync(file, 'utf8'))),
    );

    expect(offenders).toEqual([]);
  });

  it('still exposes the query builders the codebase depends on', () => {
    // Omit is a blunt instrument. If it ever removes more than intended, this
    // says so here rather than at the first query of a cold deploy.
    for (const method of ['select', 'insert', 'update', 'delete', 'execute'] as const) {
      expect(typeof db[method]).toBe('function');
    }
    expect(db.query).toBeTypeOf('object');
  });
});

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];

  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };

  walk(dir);
  return out;
}
