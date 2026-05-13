# Job Application Assistant

A local-first web app that pulls live job listings from 70+ tech-company career boards, scores your resume against each one, generates one-page tailored PDFs, and tracks your pipeline from "interesting" to "offer" — running entirely on your laptop.

> No SaaS account, no API key, no remote server. Next.js 16 + a JSON file under `data/` is the whole stack.

## Setup

### 1. Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| **Node.js** | 20+ | Runs the Next.js app and server-side scrapers |
| **LibreOffice** | 7.x or 26.x | Renders the edited `.docx` to PDF for resume tailoring (`soffice --headless`) |
| **Git** | any recent | Cloning the repo |

Install on macOS:
```bash
brew install node
brew install --cask libreoffice
```

Install on Linux (Debian/Ubuntu):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs libreoffice
```

Install on Windows: [Node.js LTS](https://nodejs.org/) and [LibreOffice](https://www.libreoffice.org/download/download/). Make sure `soffice.exe` is on your PATH (usually `C:\Program Files\LibreOffice\program`).

Verify:
```bash
node --version       # ≥ v20
soffice --version    # LibreOffice 7.x or 26.x
```

### 2. Clone and install

```bash
git clone https://github.com/dheerajkp10/job-app-assistant.git
cd job-app-assistant
npm install
```

The first `npm install` takes a couple of minutes — Puppeteer downloads its own Chromium for the Apple/Meta scrapers. Subsequent installs are fast.

### 3. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000> in your browser.

### 4. Complete the 6-step onboarding wizard

On first visit you'll be walked through:

1. **Role & Level** — job families and seniority tiers
2. **Location** — preferred cities, work mode (remote / hybrid / onsite), work-auth countries
3. **Salary** — total comp range (optional)
4. **Resume** — drag-and-drop a `.docx` (preferred) or `.pdf`
5. **Companies** — preview of the career boards we'll scan
6. **Fetch Jobs** — kicks off a live SSE-driven fetch across every source (~30–90s)

When that finishes you land on Job Listings with live data. Top-nav exposes Dashboard, Listings, Pipeline, Compare, Add Job, Settings.

### Health check

To confirm LibreOffice is wired up:
```bash
curl http://localhost:3000/api/health
# → {"libreoffice":{"ok":true,"version":"..."},"platform":"darwin"}
```

The app also surfaces a banner on every page if `soffice` is missing from your PATH.

## What it does

- **Live job aggregation** — Pulls openings from Greenhouse, Lever, Ashby, Workday, Eightfold, SmartRecruiters + company-specific APIs (Apple, Amazon, Google, Microsoft, Meta, Uber, …). Add custom sources at runtime via Settings.
- **Smart filters** — Role family, level, location, work mode, salary, ATS score range, work-auth countries, excluded companies, date-posted. Synonym-aware location matching catches `"US-SEA"`, `"USA - Remote"`, `"U.S. Remote"`, etc.
- **ATS keyword scoring** — TF-weighted scorer with JD-bigram phrase coverage. Per-listing breakdown across technical / management / domain / soft. Cache auto-invalidates when you upload a new resume; dashboard surfaces a Rescore button.
- **Salary intelligence** — Reads pay ranges directly from JD bodies (pay-transparency laws make this work for most US tech listings). Detects Base + TC splits, OTE, hourly rates, equity hints. No external scraping.
- **Resume tailoring**
  - **Per-job tailor** — Inject every keyword you select against a specific listing. Mandatory mode (default) runs a compression cascade (margins → spacing → line-height → font shrink → drop ADDITIONAL section) until the PDF fits on one page. Floors at 9pt body and 0.4" margins. No content is dropped.
  - **Master Resume** — One button on the Dashboard. Stratified-samples up to 100 listings matching your preferences, aggregates missing keywords, auto-picks the top 30 by frequency, lets you review/de-select, then runs the same cascade.
- **Application pipeline (Kanban)** — Five columns: Applied → Phone Screen → Interviewing → Offer → Rejected. Markdown status report export.
- **Cover letters, outreach emails, interview prep** — Deterministic generators using your resume's strongest signals + JD context.
- **LinkedIn network awareness** — Import your `Connections.csv` (or the raw `.zip` LinkedIn emails). Listing cards show an "N you know" badge with an expandable popover of names + profile links.
- **Compare view** — 2–3 listings side-by-side with work mode, salary range, posted date, ATS breakdown.

## Day-to-day workflow

1. **Refresh listings** (`Listings → Refresh All`) — pulls latest postings across every source.
2. **Filter** to roles you'd apply to; save the filter set as a named preset for reuse.
3. **Browse + flag** — open listings, hit per-card **Tailor My Resume**, use the flag dropdown to mark pipeline state (Applied / Phone Screen / …).
4. **Generate Master Resume** from the Dashboard once you have 50+ matching listings. Download → re-upload as your new base via Settings.
5. **Rescore** — after uploading, click the violet **Rescore listings** banner on the Dashboard. Dashboard averages update with the new resume's score.
6. **Track pipeline** on `/pipeline`; export a Markdown **Status report** when sharing with a coach.
7. **Cover letter + outreach** on demand from any listing's detail view.

## Where your data lives

Everything is under `./data/` (gitignored):

```
data/
├── db.json                # Settings, listings cache, scoreCache, listing flags,
│                          # reminders, LinkedIn network, custom sources
├── resume/                # Uploaded resume(s)
├── listing-details/       # Cached JD HTML per listing
└── tailored/              # Generated tailored PDFs
```

Delete `./data/` to reset the app to a fresh-install state. No remote backend ever sees this data.

## Updating

```bash
git pull
npm install        # picks up any new deps
npm run dev
```

The app self-migrates its DB schema on first read — work-auth countries, scorer version, pipeline flag values, salary breakdown fields, etc. all auto-fill so older `data/db.json` files keep working.

## Production build (optional)

```bash
npm run build
npm run start      # serves on http://localhost:3000
```

The dev server (`npm run dev`) is plenty for personal use and gives you hot reload.

## Architecture

Next.js 16 (App Router) with React 19 and Tailwind. JSON file as the database. All scoring + tailoring runs in-process. LibreOffice is shelled out for docx → PDF conversion. Puppeteer (auto-installed) handles a handful of company scrapers (Apple, Meta) that don't have JSON APIs.

Key files:
- `src/app/` — pages + API routes
- `src/lib/sources.ts` — registry of career boards
- `src/lib/job-fetcher.ts` + `custom-fetchers.ts` — per-ATS list/detail fetchers
- `src/lib/ats-scorer.ts` — keyword scoring + JD-bigram phrase coverage
- `src/lib/salary-parser.ts` — Base + TC + hourly + equity extraction from JD text
- `src/lib/docx-editor.ts` — Word XML edits + compression cascade for one-page fit
- `src/lib/location-match.ts` — synonym-aware location matcher

## Troubleshooting

**LibreOffice timeout when downloading a tailored PDF.** First conversion warms up LibreOffice's font cache (10–15s); subsequent ones are < 2s. If a render hangs > 30s:
```bash
pkill -f soffice
```

**Apple / Amazon / Meta listings can't be scored.** Some career APIs don't expose per-job detail endpoints — the app marks them "unscorable" and skips them silently. Apple uses Puppeteer; if its Chromium failed to download:
```bash
npx puppeteer browsers install chrome
```

**Dashboard shows my old ATS score after uploading a new resume.** The score cache wipes on resume upload, but the Dashboard surfaces a violet **Rescore listings** banner — click it to batch-rescore every scorable listing against the new resume.

**Resume tailoring overflows to 2 pages.** Mandatory mode injects every selected keyword and compresses layout (margins → spacing → line-height → font) until 1-page fit. If your base resume is already maxed out and even max compression overflows, you'll see an amber "Couldn't fit on 1 page" footer; trim a bullet in your `.docx` and re-upload, or deselect a few low-frequency keywords.

**Some companies show 0 jobs.** Board tokens occasionally rotate. Open `src/lib/sources.ts` and try alternate slugs, or add the company as a Custom Source from Settings.

**State seems stale after edits.** Settings and listings cache are server-side. Reload the browser tab; the listings + pipeline pages also auto-revalidate on tab focus.

## Contributing

PRs welcome — especially new career sources. To add one:
1. Probe the company's career page for its ATS (most use Greenhouse / Lever / Ashby / Workday / Eightfold / SmartRecruiters).
2. Add an entry to `src/lib/sources.ts` with the verified board token, or use the **Custom Sources** UI in Settings to add it at runtime.
3. Run the app, hit "Refresh All", verify listings show up.
4. If the source has a per-job detail endpoint, wire it into `fetchJobDetail()` so the listing becomes scoreable.
