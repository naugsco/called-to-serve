// Drive photo download. Best-face ranking lives in face.mjs and runs over the
// downloaded files in sync.mjs.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { getGoogleAuth } from './google-auth.mjs';

let _drive;
async function driveClient() {
  if (_drive) return _drive;
  const { google } = await import('googleapis');
  const auth = await getGoogleAuth();
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
