import { NextRequest, NextResponse } from 'next/server';
import {
  listNetworkOutreach,
  addNetworkOutreach,
  updateNetworkOutreach,
  deleteNetworkOutreach,
} from '@/lib/db';
import type { NetworkOutreach, OutreachStatus, OutreachChannel } from '@/lib/types';
import { randomUUID } from 'crypto';

/**
 * Outreach CRM endpoints. Turns the "you know N people at X" badge
 * into a tracking system: every referral request the user drafts
 * lands here, the user marks sent / replied as they happen, and the
 * outreach inbox page surfaces what needs follow-up.
 *
 *   GET    /api/network/outreach                    → all records
 *   GET    /api/network/outreach?contactKey=<key>   → for one contact
 *   GET    /api/network/outreach?company=<name>     → for one company
 *   POST   /api/network/outreach                    → create
 *   PATCH  /api/network/outreach                    → update status / fields
 *   DELETE /api/network/outreach?id=<id>            → remove
 */
export async function GET(req: NextRequest) {
  const all = await listNetworkOutreach();
  const contactKey = req.nextUrl.searchParams.get('contactKey');
  const company = req.nextUrl.searchParams.get('company');
  let out = all;
  if (contactKey) out = out.filter((x) => x.contactKey === contactKey);
  if (company) {
    const c = company.toLowerCase().trim();
    out = out.filter((x) => x.company.toLowerCase().trim() === c);
  }
  // Most-recent first across either filter (and unfiltered).
  out = [...out].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return NextResponse.json({ outreach: out });
}

const VALID_STATUSES: OutreachStatus[] = ['drafted', 'sent', 'replied', 'no-response'];
const VALID_CHANNELS: OutreachChannel[] = ['linkedin-message', 'email', 'other'];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { contactKey, contactName, company, listingId, channel, draftSubject, draftBody, notes } = body;
  if (typeof contactKey !== 'string' || !contactKey.trim()) {
    return NextResponse.json({ error: 'contactKey is required' }, { status: 400 });
  }
  if (typeof contactName !== 'string' || !contactName.trim()) {
    return NextResponse.json({ error: 'contactName is required' }, { status: 400 });
  }
  if (typeof company !== 'string' || !company.trim()) {
    return NextResponse.json({ error: 'company is required' }, { status: 400 });
  }
  if (channel && !VALID_CHANNELS.includes(channel)) {
    return NextResponse.json({ error: `channel must be one of ${VALID_CHANNELS.join(', ')}` }, { status: 400 });
  }
  // Newly-created records always start in 'drafted'. The user marks
  // sent/replied via PATCH after the actual outreach happens.
  const record: NetworkOutreach = {
    id: randomUUID(),
    contactKey: contactKey.trim(),
    contactName: contactName.trim(),
    company: company.trim(),
    listingId: typeof listingId === 'string' && listingId.trim() ? listingId.trim() : undefined,
    channel: channel ?? undefined,
    status: 'drafted',
    draftSubject: typeof draftSubject === 'string' ? draftSubject : undefined,
    draftBody: typeof draftBody === 'string' ? draftBody : undefined,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
    createdAt: new Date().toISOString(),
  };
  await addNetworkOutreach(record);
  return NextResponse.json({ outreach: record });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, channel, notes, sentAt, repliedAt } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const patch: Partial<NetworkOutreach> = {};
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    patch.status = status;
    // Convenience: when transitioning to sent / replied, stamp the
    // timestamp automatically if the caller didn't supply one.
    if (status === 'sent' && !sentAt) patch.sentAt = new Date().toISOString();
    if (status === 'replied' && !repliedAt) patch.repliedAt = new Date().toISOString();
  }
  if (channel !== undefined) {
    if (channel !== null && !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json({ error: `channel must be one of ${VALID_CHANNELS.join(', ')}` }, { status: 400 });
    }
    patch.channel = channel ?? undefined;
  }
  if (notes !== undefined) patch.notes = typeof notes === 'string' && notes.trim() ? notes.trim() : undefined;
  if (sentAt !== undefined) patch.sentAt = sentAt;
  if (repliedAt !== undefined) patch.repliedAt = repliedAt;

  const updated = await updateNetworkOutreach(id, patch);
  if (!updated) return NextResponse.json({ error: 'Outreach not found' }, { status: 404 });
  return NextResponse.json({ outreach: updated });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const ok = await deleteNetworkOutreach(id);
  if (!ok) return NextResponse.json({ error: 'Outreach not found' }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
