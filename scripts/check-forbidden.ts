/**
 * The forbidden pattern check.
 *
 * Section 14 of the build specification lists the tells of generated
 * interfaces. Most of them are judgment calls a person has to make, but several
 * are mechanically checkable, and the ones that are get checked here so they
 * cannot creep back in during a late night edit.
 *
 *   pnpm check:forbidden
 *
 * Runs in CI. A hit fails the build with the file, the line, and what to do
 * instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

interface Rule {
  name: string;
  /** Files to search. */
  extensions: string[];
  pattern: RegExp;
  why: string;
  /** Paths that are allowed to contain it, and why. */
  allow?: RegExp[];
}

const RULES: Rule[] = [
  {
    name: 'em dash',
    extensions: ['.ts', '.tsx', '.css', '.md', '.mjs', '.json', '.yml'],
    pattern: /—/g,
    why: 'Use a comma, a colon, or a full stop.',
    // The design document quotes the rule itself.
    allow: [/^DESIGN\.md$/, /^scripts\/check-forbidden\.ts$/],
  },
  {
    name: 'gradient',
    extensions: ['.tsx', '.css'],
    pattern: /linear-gradient|radial-gradient|bg-gradient-|from-\[#|via-\[#/g,
    why: 'No gradients anywhere, including subtle ones and including on buttons.',
    allow: [/^scripts\/check-forbidden\.ts$/],
  },
  {
    name: 'backdrop blur',
    extensions: ['.tsx', '.css'],
    pattern: /backdrop-blur|backdrop-filter/g,
    why: 'No glassmorphism, no translucent panels.',
    allow: [/^scripts\/check-forbidden\.ts$/],
  },
  {
    name: 'purple, indigo or violet',
    extensions: ['.tsx', '.css'],
    pattern: /\b(purple|indigo|violet)\b|#[0-9a-f]*(6[0-9a-f]|7[0-9a-f])[0-9a-f]*(3[0-9a-f])[0-9a-f]*(d[0-9a-f]|e[0-9a-f])\b/gi,
    why: 'Not as a primary and not as an accent. The action colour is #1B4A8F.',
    allow: [/^scripts\/check-forbidden\.ts$/, /^DESIGN\.md$/],
  },
  {
    name: 'emoji',
    extensions: ['.tsx'],
    pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
    why: 'No emoji in the interface.',
    allow: [/^scripts\/check-forbidden\.ts$/],
  },
  {
    name: 'reference to artificial intelligence in the interface',
    extensions: ['.tsx'],
    pattern: /\bAI[- ]powered\b|\bsparkle|\brobot\b|✨|🤖/gi,
    why: 'No AI badges, sparkle icons, or robot imagery. The model is never mentioned to a user.',
    allow: [/^scripts\/check-forbidden\.ts$/],
  },
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'test-results',
  'playwright-report',
  'drizzle',
  '.storage',
  '.storage-test',
  'public',
]);

interface Hit {
  file: string;
  line: number;
  rule: Rule;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function main(): void {
  const root = process.cwd();
  const files = walk(root);
  const hits: Hit[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const ext = extname(file);

    for (const rule of RULES) {
      if (!rule.extensions.includes(ext)) continue;
      if (rule.allow?.some((allowed) => allowed.test(rel))) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const matches = line.match(new RegExp(rule.pattern.source, rule.pattern.flags));
        if (matches) {
          hits.push({ file: rel, line: index + 1, rule, text: line.trim().slice(0, 100) });
        }
      });
    }
  }

  if (hits.length === 0) {
    process.stdout.write('No forbidden patterns found.\n');
    return;
  }

  process.stderr.write(`\n${hits.length} forbidden pattern hit(s):\n\n`);
  for (const hit of hits) {
    process.stderr.write(`  ${hit.file}:${hit.line}  ${hit.rule.name}\n`);
    process.stderr.write(`    ${hit.text}\n`);
    process.stderr.write(`    ${hit.rule.why}\n\n`);
  }
  process.exit(1);
}

main();
