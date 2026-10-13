// Photos (selfies, card photos, logo). Stored on disk under data/uploads, never in the public folder;
// they are served through routes that check who is asking.
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { config } from '../config';
import { randomToken } from '../lib/security';

const MAX_BYTES = 1_500_000;

export class ImageError extends Error {}

/** Accepts a data: URL (JPEG/PNG/WebP) and returns the path relative to the upload folder. */
export function saveDataUrlImage(dataUrl: unknown, folder: 'selfies' | 'cards' | 'branding'): string {
  if (typeof dataUrl !== 'string') throw new ImageError('No image received');
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ImageError('Please send a JPEG, PNG or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new ImageError('That image is too big (1.5 MB maximum)');
  // Check the file really is the image type it claims to be.
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf.subarray(0, 4).toString('hex') === '89504e47';
  const isWebp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new ImageError('That file is not an image');
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
  const name = `${folder}/${Date.now()}-${randomToken(9)}.${ext}`;
  writeFileSync(join(config.uploadDir, name), buf);
  return name;
}

/** Absolute path for a stored file, refusing anything outside the upload folder. */
export function uploadPath(rel: string | null | undefined): string | null {
  if (!rel) return null;
  const root = resolve(config.uploadDir);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep) || !existsSync(abs)) return null;
  return abs;
}

export function deleteUpload(rel: string | null | undefined) {
  const abs = uploadPath(rel);
  if (abs) {
    try {
      unlinkSync(abs);
    } catch {
      /* already gone */
    }
  }
}

/** Remove selfie files older than the retention period that are no longer referenced. */
export function sweepOrphans(folder: 'selfies' | 'cards', keep: Set<string>, olderThanMs: number) {
  const dir = join(config.uploadDir, folder);
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    const rel = `${folder}/${f}`;
    if (keep.has(rel)) continue;
    const abs = join(dir, f);
    if (Date.now() - statSync(abs).mtimeMs > olderThanMs) {
      unlinkSync(abs);
      n++;
    }
  }
  return n;
}
