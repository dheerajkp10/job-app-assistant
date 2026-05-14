import { NextRequest, NextResponse } from 'next/server';
import { getListingNotes, getListingNote, setListingNote } from '@/lib/db';

/**
 * Per-listing free-form notes — research, contact names, "why I passed
 * on this," anything the user wants attached to a specific job. Stored
 * in db.listingNotes keyed by listingId. Empty text deletes.
 *
 * GET  /api/listing-notes                 → { [listingId]: ListingNote }
 * GET  /api/listing-notes?listingId=<id>  → ListingNote | null
 * POST /api/listing-notes                 → body: { listingId, text }
 *                                            text="" deletes the note.
 */
export async function GET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get('listingId');
  if (listingId) {
    const note = await getListingNote(listingId);
    return NextResponse.json({ note });
  }
  const notes = await getListingNotes();
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const { listingId, text } = await req.json();
  if (!listingId || typeof listingId !== 'string') {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'text must be a string (use "" to delete)' }, { status: 400 });
  }
  const note = await setListingNote(listingId, text);
  return NextResponse.json({ note });
}
