import { NextRequest, NextResponse } from 'next/server';
import { getListingFlags, setListingFlag, clearListingFlag, readDb, writeDb, getSettings } from '@/lib/db';
import type { ListingFlag, Reminder } from '@/lib/types';
import { randomUUID } from 'crypto';

// The full set of accepted flag values. Was previously
// ['applied', 'incorrect', 'not-applicable'] which silently 400'd
// pipeline-only flags (phone-screen / interviewing / offer / rejected)
// — that's why marking a listing as "Rejected" on the Listings page
// never showed up on the Kanban board. Keep this in sync with the
// `ListingFlag` union in `src/lib/types.ts`.
const VALID_FLAGS: ListingFlag[] = [
  'applied',
  'phone-screen',
  'interviewing',
  'offer',
  'rejected',
  'incorrect',
  'not-applicable',
];

/**
 * GET  /api/listing-flags              → { [listingId]: ListingFlagEntry }
 * POST /api/listing-flags              → body: { listingId, flag | null }
 *   - flag=null clears the flag for that listing.
 */
export async function GET() {
  const flags = await getListingFlags();
  return NextResponse.json(flags);
}

export async function POST(req: NextRequest) {
  const { listingId, flag } = await req.json();

  if (!listingId || typeof listingId !== 'string') {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  if (flag === null || flag === undefined) {
    const cleared = await clearListingFlag(listingId);
    return NextResponse.json({ ok: true, cleared });
  }

  if (!VALID_FLAGS.includes(flag)) {
    return NextResponse.json(
      { error: `flag must be one of ${VALID_FLAGS.join(', ')} or null` },
      { status: 400 }
    );
  }

  const entry = await setListingFlag(listingId, flag);

  // Time-aware reminder auto-creation. When the flag becomes
  // 'applied', schedule a follow-up reminder for N days from now
  // (settings.applyFollowupDays, default 14). Skips if there's
  // already an unfired auto-applied reminder for this listing, so
  // re-flagging Applied doesn't pile up duplicates.
  let autoReminder: Reminder | undefined;
  if (flag === 'applied') {
    autoReminder = await maybeScheduleApplyReminder(listingId);
  }

  return NextResponse.json({ ...entry, autoReminder });
}

/**
 * Auto-create a follow-up reminder when a listing is flagged
 * Applied. Returns the new reminder, or undefined when one was
 * already scheduled (idempotent) or auto-reminders are disabled
 * (settings.applyFollowupDays === 0).
 */
async function maybeScheduleApplyReminder(listingId: string): Promise<Reminder | undefined> {
  const settings = await getSettings();
  const days = typeof settings.applyFollowupDays === 'number'
    ? settings.applyFollowupDays
    : 14;
  if (!Number.isFinite(days) || days <= 0) return undefined;

  const db = await readDb();
  const existing = (db.reminders ?? []).find(
    (r) => r.listingId === listingId &&
           r.source === 'auto-applied' &&
           !r.firedAt,
  );
  if (existing) return undefined;

  const dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const reminder: Reminder = {
    id: randomUUID(),
    listingId,
    dueAt,
    note: `Follow up — applied ${days} days ago, no response yet?`,
    createdAt: new Date().toISOString(),
    source: 'auto-applied',
  };
  db.reminders = [...(db.reminders ?? []), reminder];
  await writeDb(db);
  return reminder;
}
