import { NextResponse } from 'next/server';
import { saveListingsCache } from '@/lib/db';
import { fetchAllJobs } from '@/lib/job-fetcher';
import { COMPANY_SOURCES } from '@/lib/sources';
import type { JobListing } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const allListings: JobListing[] = [];
      const errors: { company: string; error: string }[] = [];
      const total = COMPANY_SOURCES.length;
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

      for (let i = 0; i < COMPANY_SOURCES.length; i += BATCH_SIZE) {
        const batch = COMPANY_SOURCES.slice(i, i + BATCH_SIZE);

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
