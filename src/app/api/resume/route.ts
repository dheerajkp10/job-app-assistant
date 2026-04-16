import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { getSettings, updateSettings } from '@/lib/db';

const RESUME_DIR = path.join(process.cwd(), 'data', 'resume');

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    fileName: settings.baseResumeFileName,
    text: settings.baseResumeText,
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name).toLowerCase();

  if (ext !== '.docx' && ext !== '.pdf') {
    return NextResponse.json(
      { error: 'Only .docx and .pdf files are supported' },
      { status: 400 }
    );
  }

  // Save the file
  if (!existsSync(RESUME_DIR)) {
    await mkdir(RESUME_DIR, { recursive: true });
  }
  const filePath = path.join(RESUME_DIR, `base-resume${ext}`);
  await writeFile(filePath, buffer);

  // Parse text
  let text = '';
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    // For PDF, use pdf-parse v1
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    text = data.text;
  }

  await updateSettings({
    baseResumeFileName: file.name,
    baseResumeText: text,
  });

  return NextResponse.json({ fileName: file.name, text });
}
