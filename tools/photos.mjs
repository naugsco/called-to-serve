// Drive photo download + "best face" selection.
//
// Two passes:
//   1. For each submission with a Drive URL, list & download all photos in the
//      submission's Drive subfolder (or the single file if direct).
//   2. Score each photo with face-api (Node build) and keep the highest scorer
//      as `bestPhoto`; keep the rest in `photos` for the carousel.
//
// face-api is heavy (model files + canvas dep). Until wired, this module exports
// `selectBestPhoto` as a no-op that returns the first photo.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

let _drive;
async function driveClient() {
  if (_drive) return _drive;
  const { google } = await import('googleapis');
  const raw = process.env.GOOGLE_SA_JSON;
  if (!raw) throw new Error('GOOGLE_SA_JSON not set');
  const creds = raw.trim().startsWith('{')
    ? JSON.parse(raw)
    : JSON.parse(await readFile(raw, 'utf8'));
  const auth = new google.auth.JWT(
    creds.client_email, null, creds.private_key,
    ['https://www.googleapis.com/auth/drive.readonly']
  );
  await auth.authorize();
  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

const FILE_ID_RE = /[-\w]{25,}/;

export async function downloadPhoto(driveUrl, destPath) {
  const id = driveUrl.match(FILE_ID_RE)?.[0];
  if (!id) throw new Error(`Cannot parse Drive ID from URL: ${driveUrl}`);
  const drive = await driveClient();
  const res = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, Buffer.from(res.data));
  return destPath;
}

// TODO(face-api): wire up @vladmandic/face-api to score faces.
// For now, just return the first available photo.
export function selectBestPhoto(localPaths) {
  return localPaths[0] ?? null;
}
