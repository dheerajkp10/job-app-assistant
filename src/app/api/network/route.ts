import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/db';
import type { NetworkContact } from '@/lib/types';

/**
 * GET    /api/network
 *   Returns { contacts, updatedAt }.
 *
 * POST   /api/network
 *   Multipart with file=<Connections.csv> OR JSON { csv: string }.
 *   Replaces the stored network with the parsed result.
 *
 * DELETE /api/network
 *   Clears the stored network entirely.
 *
 * GET    /api/network?company=<name>
 *   Returns contacts matching that company (case-insensitive substring).
 *   Used by the listing card to render "N contacts at <Company>".
 */

/**
 * LinkedIn's exported Connections.csv has an oddity: the first 2-3
 * lines can be a "Notes:" preamble (newer exports) before the actual
 * column header. We scan for the line that starts with "First Name"
 * to find the real header row.
 */
function parseLinkedInCsv(csv: string): NetworkContact[] {
  const lines = csv.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/^"?first name"?,/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];

  // Tiny CSV parser — handles quoted fields with embedded commas. We
  // don't pull a CSV lib for this single use-case; the LinkedIn
  // shape is fixed and small.
  const splitCsv = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const header = splitCsv(lines[headerIdx]).map((h) => h.toLowerCase().replace(/"/g, '').trim());
  const idxFirst = header.indexOf('first name');
  const idxLast = header.indexOf('last name');
  const idxCompany = header.indexOf('company');
  const idxPosition = header.indexOf('position');
  const idxUrl = header.findIndex((h) => h.includes('url'));
  const idxOn = header.indexOf('connected on');

  const contacts: NetworkContact[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitCsv(line);
    const company = (cells[idxCompany] ?? '').replace(/"/g, '').trim();
    if (!company) continue;
    contacts.push({
      firstName: (cells[idxFirst] ?? '').replace(/"/g, '').trim(),
      lastName: (cells[idxLast] ?? '').replace(/"/g, '').trim(),
      company: company.toLowerCase(),
      position: idxPosition >= 0 ? (cells[idxPosition] ?? '').replace(/"/g, '').trim() : undefined,
      url: idxUrl >= 0 ? (cells[idxUrl] ?? '').replace(/"/g, '').trim() : undefined,
      connectedOn: idxOn >= 0 ? (cells[idxOn] ?? '').replace(/"/g, '').trim() : undefined,
    });
  }
  return contacts;
}

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company');
  const settings = await getSettings();
  const contacts = settings.network ?? [];
  if (company) {
    const q = company.toLowerCase();
    const matches = contacts.filter((c) => c.company.includes(q) || q.includes(c.company));
    return NextResponse.json({ contacts: matches, total: contacts.length });
  }
  return NextResponse.json({
    contacts,
    total: contacts.length,
    updatedAt: settings.networkUpdatedAt,
  });
}

/**
 * Dedup key for a contact. We hash on the LinkedIn profile URL when
 * present (most reliable — survives re-exports + name typos), falling
 * back to `firstName|lastName|company` so older exports without the
 * URL column still dedupe sanely. Lowercased to absorb casing
 * variation across LinkedIn's CSVs.
 */
function dedupKey(c: NetworkContact): string {
  if (c.url) return c.url.trim().toLowerCase();
  return `${c.firstName}|${c.lastName}|${c.company}`.toLowerCase();
}

/**
 * Extract Connections.csv text from a LinkedIn data-export .zip.
 * LinkedIn splits large exports into multiple zips (e.g.
 * `Basic_LinkedInDataExport_06-01-2025.zip` plus
 * `Complete_LinkedInDataExport_06-08-2025.zip`); each part may contain
 * its own Connections.csv. We pick the first file whose name matches
 * `Connections.csv` (case-insensitive, any subfolder).
 */
async function extractConnectionsCsvFromZip(buf: ArrayBuffer): Promise<string | null> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  for (const path of Object.keys(zip.files)) {
    if (/(^|\/)connections\.csv$/i.test(path)) {
      return zip.files[path].async('string');
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') ?? '';
  // ── Collect raw CSV payloads from every supplied source ───────────
  // Supports: (a) JSON `{ csv }`, (b) single `file=` form upload,
  // (c) multi-file `files=` form upload, (d) any of those files being
  // a LinkedIn data-export .zip (we crack it open and pull
  // Connections.csv out). Multi-file is the path the LinkedIn split-
  // export users need — drop both `Basic_…zip` + `Complete_…zip` at
  // once and we merge everything.
  const csvParts: string[] = [];
  let mode: 'merge' | 'replace' = 'merge';

  if (ct.includes('application/json')) {
    const body = await req.json();
    if (typeof body?.csv === 'string') csvParts.push(body.csv);
    if (body?.mode === 'replace') mode = 'replace';
  } else {
    const form = await req.formData();
    const modeRaw = form.get('mode');
    if (typeof modeRaw === 'string' && modeRaw === 'replace') mode = 'replace';

    // Accept both `file` (legacy single) and `files` (new multi) field
    // names. Browsers serializing a `<input multiple>` use the same
    // name repeatedly, so getAll is what we want.
    const collected: File[] = [];
    const singles = form.getAll('file');
    const multi = form.getAll('files');
    for (const v of [...singles, ...multi]) {
      if (v instanceof File) collected.push(v);
    }
    if (collected.length === 0) {
      return NextResponse.json(
        { error: 'At least one file is required' },
        { status: 400 },
      );
    }
    for (const f of collected) {
      const name = f.name.toLowerCase();
      if (name.endsWith('.zip')) {
        const csv = await extractConnectionsCsvFromZip(await f.arrayBuffer());
        if (!csv) {
          return NextResponse.json(
            { error: `Couldn't find Connections.csv inside ${f.name}` },
            { status: 400 },
          );
        }
        csvParts.push(csv);
      } else {
        csvParts.push(await f.text());
      }
    }
  }

  // ── Parse + merge ────────────────────────────────────────────────
  const parsed: NetworkContact[] = [];
  for (const csv of csvParts) parsed.push(...parseLinkedInCsv(csv));

  const settings = await getSettings();
  const existing = mode === 'merge' ? (settings.network ?? []) : [];

  // Dedupe across existing + new. Last write wins so a fresher export
  // overwrites a stale row for the same person.
  const byKey = new Map<string, NetworkContact>();
  for (const c of existing) byKey.set(dedupKey(c), c);
  let added = 0;
  for (const c of parsed) {
    const k = dedupKey(c);
    if (!byKey.has(k)) added += 1;
    byKey.set(k, c);
  }
  const merged = Array.from(byKey.values());

  await updateSettings({
    network: merged,
    networkUpdatedAt: new Date().toISOString(),
  });
  return NextResponse.json({
    contacts: merged.length,
    total: merged.length,
    addedThisUpload: added,
    parsedThisUpload: parsed.length,
    mode,
  });
}

export async function DELETE() {
  await updateSettings({ network: [], networkUpdatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
