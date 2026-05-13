import { NextRequest, NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';
import type { Reminder } from '@/lib/types';
import { randomUUID } from 'crypto';

/**
 * GET    /api/reminders
 *   Returns all reminders. Includes both fired and unfired so the
 *   client can render history if needed; the default home view only
 *   shows the unfired ones.
 *
 * POST   /api/reminders
 *   Body: { listingId, dueAt, note }  → adds a new reminder.
 *
 * PATCH  /api/reminders
 *   Body: { id, firedAt? }            → marks a reminder fired (or
 *                                        un-fires by sending firedAt:null).
 *
 * DELETE /api/reminders?id=<id>
 *   Removes a reminder permanently.
 */

export async function GET() {
  const db = await readDb();
  return NextResponse.json({ reminders: db.reminders ?? [] });
}

export async function POST(req: NextRequest) {
  const { listingId, dueAt, note } = await req.json();
  if (!listingId || !dueAt) {
    return NextResponse.json({ error: 'listingId and dueAt are required' }, { status: 400 });
  }
  const due = new Date(dueAt);
  if (isNaN(due.getTime())) {
    return NextResponse.json({ error: 'dueAt is not a valid date' }, { status: 400 });
  }
  const reminder: Reminder = {
    id: randomUUID(),
    listingId,
    dueAt: due.toISOString(),
    note: (note ?? '').toString().slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  const db = await readDb();
  db.reminders = [...(db.reminders ?? []), reminder];
  await writeDb(db);
  return NextResponse.json({ reminder });
}

export async function PATCH(req: NextRequest) {
  const { id, firedAt } = await req.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const db = await readDb();
  const list = db.reminders ?? [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  list[idx] = {
    ...list[idx],
    firedAt: firedAt === null ? undefined : (firedAt ?? new Date().toISOString()),
  };
  db.reminders = list;
  await writeDb(db);
  return NextResponse.json({ reminder: list[idx] });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const db = await readDb();
  db.reminders = (db.reminders ?? []).filter((r) => r.id !== id);
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
