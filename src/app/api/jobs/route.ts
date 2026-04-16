import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { getJobs, addJob } from '@/lib/db';
import type { Job, JobPortal, JobStatus } from '@/lib/types';

export async function GET() {
  const jobs = await getJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { portal, companyName, jobTitle, location, jobUrl, description, notes } = body;

  if (!companyName || !jobTitle || !description) {
    return NextResponse.json(
      { error: 'companyName, jobTitle, and description are required' },
      { status: 400 }
    );
  }

  const job: Job = {
    id: uuid(),
    portal: (portal as JobPortal) || 'company',
    companyName,
    jobTitle,
    location: location || '',
    jobUrl: jobUrl || null,
    description,
    status: 'new' as JobStatus,
    notes: notes || '',
    dateAdded: new Date().toISOString(),
  };

  await addJob(job);
  return NextResponse.json({ job }, { status: 201 });
}
