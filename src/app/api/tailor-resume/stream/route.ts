import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/tailor-resume/stream
 *
 * Server-Sent Events wrapper around the existing tailor pipeline.
 * Lets the UI show live progress while the (8–25 second) docx → PDF
 * render cycle runs, instead of leaving the user staring at a generic
 * spinner and wondering whether the request hung.
 *
 * Wire shape
 * ──────────
 * Body: same as POST /api/tailor-resume (listingId, format, selectedKeywords,
 *       selectedSuggestions). The `format` should be 'pdf' or 'docx' —
 *       the JSON analysis path is fast enough that streaming progress
 *       is unnecessary.
 *
 * Response: text/event-stream with these event types:
 *   - { type: 'start', message }
 *   - { type: 'progress', stage, elapsedSec, message }   (every ~1s)
 *   - { type: 'done', filename, contentType, base64 }    (single, terminal)
 *   - { type: 'error', message }                          (single, terminal)
 *
 * Implementation
 * ──────────────
 * The route forwards the same payload to the existing /api/tailor-resume
 * endpoint over the same Next.js server (no network hop in production),
 * then races the fetch against a 1-second-cadence progress emitter that
 * cycles through realistic stage labels keyed off elapsed time. When the
 * inner request resolves, we base64-encode the body and emit a 'done'
 * event so the client can trigger the download from a Blob.
 *
 * Why not real per-tier progress
 * ──────────────────────────────
 * The existing tailor route is ~650 lines of carefully-stitched closures
 * (helper functions defined inside POST, captured-state for budget caps,
 * cross-tier best-attempt tracking). Surgical SSE injection into that
 * file is high-regression-risk. This wrapper gives ~80% of the UX win
 * (visible activity + credible stage labels) with zero changes to the
 * proven pipeline. We can swap to true tier-level events in a future
 * iteration once the wrapper is validated.
 */

// Stage labels played out over time. Indexed by elapsed seconds —
// each tier of the budget ladder takes ~2s under typical load
// (LibreOffice render dominates), so this cadence lines up with the
// real progress underneath. Once the actual fetch completes the
// remaining stages stop being shown.
const STAGES: { atSec: number; stage: string; message: string }[] = [
  { atSec: 0, stage: 'analyze', message: 'Analyzing job description and your resume' },
  { atSec: 1, stage: 'gaps', message: 'Computing keyword gaps and suggestion edits' },
  { atSec: 3, stage: 'tier-aggressive', message: 'Trying aggressive tier — adding new bullets and inline keywords' },
  { atSec: 7, stage: 'tier-balanced', message: 'Trying balanced tier — fewer additions to fit the page' },
  { atSec: 12, stage: 'tier-conservative', message: 'Trying conservative tier — Skills + Summary only' },
  { atSec: 17, stage: 'no-additional', message: 'Removing ADDITIONAL section to recover space, retrying' },
  { atSec: 22, stage: 'balance', message: 'Balancing top/bottom whitespace via measurement-driven re-render' },
  { atSec: 28, stage: 'finalizing', message: 'Finalizing 1-page PDF' },
];

function pickStage(elapsedSec: number): { stage: string; message: string } {
  // Pick the latest stage whose timestamp has been reached.
  let chosen = STAGES[0];
  for (const s of STAGES) {
    if (s.atSec <= elapsedSec) chosen = s;
    else break;
  }
  return { stage: chosen.stage, message: chosen.message };
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: object) => {
        if (closed) return;
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      emit({ type: 'start', message: 'Starting tailoring pipeline' });

      // Forward to the actual tailor endpoint. We construct the URL
      // from the incoming request so this works in both dev and any
      // future hosted deploy without hardcoding localhost.
      const targetUrl = new URL('/api/tailor-resume', req.url);
      const startMs = Date.now();
      const fetchPromise = fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Heartbeat: every 1s, advance the stage label based on elapsed
      // time. The real pipeline doesn't surface per-tier signals here
      // (see header comment) so we use a calibrated time-table that
      // matches typical render timings.
      const interval = setInterval(() => {
        if (closed) return;
        const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
        const { stage, message } = pickStage(elapsedSec);
        emit({ type: 'progress', stage, elapsedSec, message });
      }, 1000);

      try {
        const res = await fetchPromise;
        if (!res.ok) {
          // The tailor route returns a JSON error when something went
          // wrong (e.g. PDF-only resume, no resume uploaded). Forward
          // the message so the modal can surface it to the user.
          let errMessage = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j && typeof j.error === 'string') errMessage = j.error;
          } catch {
            // not JSON — keep status code
          }
          emit({ type: 'error', message: errMessage });
          return;
        }

        const contentType = res.headers.get('Content-Type') ?? 'application/octet-stream';
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const fnameMatch = disposition.match(/filename="([^"]+)"/);
        const filename = fnameMatch?.[1] ?? 'tailored_resume';

        const buffer = Buffer.from(await res.arrayBuffer());
        // For PDF / docx files, base64-encode and ship in the final
        // event. Sizes are typically 60–250 KB which is fine to embed
        // in a single SSE frame.
        emit({
          type: 'done',
          contentType,
          filename,
          base64: buffer.toString('base64'),
        });
      } catch (err) {
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : 'Tailoring failed',
        });
      } finally {
        clearInterval(interval);
        closed = true;
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
