import { NextRequest, NextResponse } from 'next/server';
import {
  listCoverLetterTemplates,
  addCoverLetterTemplate,
  updateCoverLetterTemplate,
  deleteCoverLetterTemplate,
} from '@/lib/db';

/**
 * Cover-letter template library.
 *
 *   GET    /api/cover-letter-templates           → CoverLetterTemplate[]
 *   POST   /api/cover-letter-templates           → body: { name, text }
 *   PATCH  /api/cover-letter-templates           → body: { id, name?, text? }
 *   DELETE /api/cover-letter-templates?id=<id>
 *
 * Stored in db.settings.coverLetterTemplates. No per-listing
 * association — templates are reusable starting points.
 */
export async function GET() {
  const templates = await listCoverLetterTemplates();
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const { name, text } = await req.json();
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  const id = `clt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await addCoverLetterTemplate({
    id,
    name: name.trim(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ template: t });
}

export async function PATCH(req: NextRequest) {
  const { id, name, text } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const patch: { name?: string; text?: string } = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim();
  if (typeof text === 'string' && text.trim()) patch.text = text.trim();
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'name or text is required' }, { status: 400 });
  }
  const updated = await updateCoverLetterTemplate(id, patch);
  if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ template: updated });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const ok = await deleteCoverLetterTemplate(id);
  if (!ok) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
