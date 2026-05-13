import { NextResponse } from 'next/server';
import { execFile } from 'child_process';

/**
 * GET /api/health
 *
 * Runtime dependency probe. The app shells out to `soffice --headless`
 * for resume → PDF conversion; if LibreOffice isn't installed the
 * tailor route fails late with a confusing `ENOENT`. This route checks
 * for the dep at the top of the listings page so users see an
 * actionable banner ("Install via `brew install --cask libreoffice`")
 * BEFORE they click Tailor and hit a wall.
 *
 * Cheap to call — single subprocess with `--version`, ≤ 200ms even on
 * cold cache. The listings page caches the result for the session via
 * a useState gate so we don't hammer this on every navigation.
 */

function probeSoffice(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    execFile('soffice', ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        // Most common case: ENOENT — `soffice` not on PATH.
        resolve({ ok: false, error: err.message });
        return;
      }
      const version = (stdout || stderr || '').trim().split('\n')[0];
      resolve({ ok: true, version });
    });
  });
}

export async function GET() {
  const soffice = await probeSoffice();
  // The platform hint is best-effort — Node's process.platform reports
  // what the SERVER is running on, which for this local-first app is
  // also what the user is on. Lets us tailor the install command.
  const platform = process.platform; // 'darwin' | 'linux' | 'win32' | …
  return NextResponse.json({
    libreoffice: soffice,
    platform,
  });
}
