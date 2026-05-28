// Shared Google auth helper. Two paths, picked automatically:
//
//   1. Service-account key  (preferred for CI/headless)
//      - Set GOOGLE_SA_JSON to either a path to the JSON file or the raw JSON.
//      - Auth via JWT.
//
//   2. Application Default Credentials  (no key file needed — useful when an
//      org policy like iam.disableServiceAccountKeyCreation blocks creating a
//      JSON key for the service account)
//      - Locally: install gcloud and run `gcloud auth application-default login`
//        once. Authenticates as YOUR Google account, so the sheets/drive folder
//        must be shared with you (they are — you own them).
//      - In CI: works only with Workload Identity Federation; for a simple
//        cron job, the SA-key path is usually easier.

import { readFile } from 'node:fs/promises';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

let cached = null;
let cachedLabel = '';

export async function getGoogleAuth() {
  if (cached) return cached;
  const { google } = await import('googleapis');
  const raw = process.env.GOOGLE_SA_JSON;

  if (raw) {
    let creds;
    try {
      creds = raw.trim().startsWith('{')
        ? JSON.parse(raw)
        : JSON.parse(await readFile(raw, 'utf8'));
    } catch (err) {
      throw new Error(
        `GOOGLE_SA_JSON is set but couldn't be loaded as JSON.\n` +
        `  value (truncated): ${raw.slice(0, 80)}...\n` +
        `  error: ${err.message}\n` +
        `Expected: an absolute path to the SA key file, OR the raw JSON contents.`
      );
    }
    const auth = new google.auth.JWT(
      creds.client_email, null, creds.private_key, SCOPES
    );
    await auth.authorize();
    cached = auth;
    cachedLabel = `service account ${creds.client_email}`;
    return auth;
  }

  // ADC: gcloud user creds, GCE metadata, or GOOGLE_APPLICATION_CREDENTIALS.
  try {
    const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
    // getClient() throws if no credentials are discoverable; verify up front
    // so failure happens here with our friendly message rather than deeper
    // inside the sheets call.
    await auth.getClient();
    const project = await auth.getProjectId().catch(() => null);
    cached = auth;
    cachedLabel = project
      ? `Application Default Credentials (project: ${project})`
      : 'Application Default Credentials';
    return auth;
  } catch (err) {
    throw new Error(
      `Google auth not configured. Pick one:\n\n` +
      `  A) Service account key  (no extra software needed)\n` +
      `     Set GOOGLE_SA_JSON in tools/.secrets/.env to the key file path.\n\n` +
      `  B) Application Default Credentials  (no key file needed)\n` +
      `     Install gcloud and run:\n` +
      `       gcloud auth application-default login\n` +
      `     Then re-run sync.\n\n` +
      `Underlying error: ${err.message}`
    );
  }
}

export function describeAuth() {
  return cachedLabel || '(not yet initialised)';
}
