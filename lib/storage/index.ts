/**
 * Document storage.
 *
 * Two drivers behind one interface. Cloudflare R2 over the S3 API is what runs
 * in production. A local filesystem driver exists for development, and
 * lib/env.ts refuses to start in PHI_MODE=live without R2, so the convenience
 * cannot reach an environment holding patient documents.
 *
 * Keys are structured `org/<orgId>/denial/<denialId>/<kind>/<uuid>-<filename>`
 * so that erasing an organisation is a prefix delete rather than a join.
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

export interface StoredObject {
  key: string;
  byteSize: number;
  contentHash: string;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** A short lived URL a browser can use to download the original. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  /** Delete everything under a prefix. Returns how many objects went. */
  deletePrefix(prefix: string): Promise<number>;
}

export function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Strip anything from a client supplied filename that could escape a path. */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'document';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'document';
}

export function denialDocumentKey(
  organizationId: string,
  denialId: string,
  kind: string,
  filename: string,
): string {
  return `org/${organizationId}/denial/${denialId}/${kind}/${randomUUID()}-${safeFilename(filename)}`;
}

export function organizationPrefix(organizationId: string): string {
  return `org/${organizationId}/`;
}

/* ─── R2 ──────────────────────────────────────────────────────────────────── */

class R2Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = env.R2_BUCKET!;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, byteSize: body.byteLength, contentHash: sha256(body) };
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;

    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys },
          }),
        );
        deleted += keys.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);

    return deleted;
  }
}

/* ─── Local disk ──────────────────────────────────────────────────────────── */

class LocalStorage implements Storage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(process.cwd(), dir);
  }

  /** Resolve a key under the root, refusing anything that climbs out of it. */
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Storage key resolves outside the storage root.');
    }
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return { key, byteSize: body.byteLength, contentHash: sha256(body) };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async signedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    // No object store to sign against. The download route reads through the
    // application instead, which is the only path that can authorise it anyway.
    return `/app/documents/${encodeURIComponent(key)}`;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const full = this.path(prefix);
    const { readdir, stat } = await import('node:fs/promises');

    async function countFiles(path: string): Promise<number> {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        let n = 0;
        for (const entry of entries) {
          const child = join(path, entry.name);
          n += entry.isDirectory() ? await countFiles(child) : 1;
        }
        return n;
      } catch {
        return 0;
      }
    }

    try {
      await stat(full);
    } catch {
      return 0;
    }

    const n = await countFiles(full);
    await rm(full, { recursive: true, force: true });
    return n;
  }
}

/* ─── Selection ───────────────────────────────────────────────────────────── */

let instance: Storage | null = null;

export function storage(): Storage {
  if (instance) return instance;

  if (env.storageIsR2) {
    instance = new R2Storage();
  } else {
    log.warn(
      'documents are being written to local disk. This is a development convenience ' +
        'and lib/env.ts refuses it in PHI_MODE=live.',
      { dir: env.LOCAL_STORAGE_DIR },
    );
    instance = new LocalStorage(env.LOCAL_STORAGE_DIR!);
  }

  return instance;
}
