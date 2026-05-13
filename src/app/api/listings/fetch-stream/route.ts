import { NextResponse } from 'next/server';
import { saveListingsCache } from '@/lib/db';
import { fetchAllJobs } from '@/lib/job-fetcher';
import { getAllSources } from '@/lib/sources';
import type { JobListing } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Module-scoped mutex. The Refresh All button is debounced on the
 * client (the streamingRefresh callback gates on its own `refreshing`
 * state), but multiple browser tabs / a quick page reload can still
 * fire two concurrent GETs against this endpoint. Both would race-write
 * to db.json via saveListingsCache(), risking a corrupt JSON file. The
 * mutex returns a 409 to any request that arrives while a fetch is
 * already running, so only the first stream wins.
 *
 * Module-scope is fine here because Next.js runs all route handlers
 * inside one Node process for this single-user local-first app.
 */
let refreshInFlight = false;

export async function GET() {
  if (refreshInFlight) {
    return NextResponse.json(
      {
        error:
          'A refresh is already in progress. Wait for it to complete before starting another one.',
      },
      { status: 409 },
    );
  }
  refreshInFlight = true;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
      const allListings: JobListing[] = [];
      const errors: { company: string; error: string }[] = [];
      // Pull the union of static + user-added custom sources at the
      // start of the stream so per-batch slicing below stays correct
      // even if `Settings.customSources` is mutated mid-fetch.
      const sources = await getAllSources();
      const total = sources.length;
      let completed = 0;

      // Send initial event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'start',
            total,
            message: `Fetching jobs from ${total} companies...`,
          })}\n\n`
        )
      );

      // Fetch in batches of 5 for controlled parallelism with per-company progress
      const BATCH_SIZE = 5;

      for (let i = 0; i < sources.length; i += BATCH_SIZE) {
        const batch = sources.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (source) => {
            const result = await fetchAllJobs([source]);
            return { source, listings: result.listings, errors: result.errors };
          })
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const source = batch[j];
          completed++;

          if (result.status === 'fulfilled') {
            const { listings, errors: fetchErrors } = result.value;
            allListings.push(...listings);
            errors.push(...fetchErrors);

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'progress',
                  completed,
                  total,
                  company: source.name,
                  jobsFound: listings.length,
                  totalJobsSoFar: allListings.length,
                  status: fetchErrors.length > 0 ? 'error' : 'success',
                })}\n\n`
              )
            );
          } else {
            errors.push({
              company: source.name,
              error: result.reason?.message || 'Unknown error',
            });

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'progress',
                  completed,
                  total,
                  company: source.name,
                  jobsFound: 0,
                  totalJobsSoFar: allListings.length,
                  status: 'error',
                })}\n\n`
              )
            );
          }
        }
      }

      // Save to cache
      await saveListingsCache({
        listings: allListings,
        lastFetchedAt: new Date().toISOString(),
        fetchErrors: errors,
      });

      // Send completion event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'complete',
            totalJobs: allListings.length,
            companiesSuccess: total - errors.length,
            companiesFailed: errors.length,
            errors,
          })}\n\n`
        )
      );

      controller.close();
      } finally {
        // Always release the mutex, even if any of the per-batch
        // fetches threw. Without this, a single error would leave
        // the app stuck in "refresh in progress" forever.
        refreshInFlight = false;
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
