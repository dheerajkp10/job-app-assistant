import { NextRequest, NextResponse } from 'next/server';
import { extractJobFromUrl } from '@/lib/job-extractor';

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  try {
    const result = await extractJobFromUrl(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to extract job from URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
