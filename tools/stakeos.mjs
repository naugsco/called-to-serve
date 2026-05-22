// StakeOS roster pull.
//
// In production this should invoke `currently_serving_missionaries` from the
// StakeOS MCP. The MCP is typically only available from the user's IDE, not
// from CI, so the recommended pattern is:
//
//   • In CI (GitHub Actions): use sheets.mjs `readRoster()` against the master
//     sheet as the source of truth.
//   • Locally: optionally invoke this module to cross-check the master sheet
//     against StakeOS via a small CLI shim that proxies the MCP call.
//
// For now this throws — the master sheet is the de facto source of truth.

export async function fetchCurrentlyServing() {
  if (process.env.STAKEOS_SHIM_CMD) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec(process.env.STAKEOS_SHIM_CMD, [], { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  throw new Error('STAKEOS_SHIM_CMD not set — using sheets.mjs roster instead.');
}
