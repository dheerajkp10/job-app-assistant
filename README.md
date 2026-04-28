# Job Application Assistant

A local-first web app for tracking and improving job applications. It pulls live listings from 70+ tech-company career APIs, scores your resume against each one, and produces a tailored, 1-page PDF resume per role — all running on your laptop, with your data staying on your laptop.

> No SaaS account, no API key, no remote server. The app boots in ~10 seconds and uses Next.js 16 + a JSON file under `data/` as its database.

## What it does

- **Live job aggregation** — Pulls openings from Greenhouse, Lever, Ashby, Workday, Eightfold, and a half-dozen company-specific APIs (Apple, Amazon, Google, Microsoft, Meta, Uber, …) into a single searchable dashboard.
- **Smart filters** — Filter by role family, level (EM1 → VP), location, work mode, salary range, work-authorization countries, and excluded companies. All persist across sessions.
- **ATS keyword scoring** — Compares your uploaded `.docx` resume against each job description and produces an overall match score with category breakdowns (technical / management / domain / soft).
- **Tailoring suggestions** — Beyond just adding missing keywords, the app suggests structural fixes: mirror the JD's role title, fill skills-line gaps, match years-of-experience claims, fold in distinctive multi-word JD phrases. Each suggestion is opt-in and applied à la carte.
- **Tailored PDF output** — One-page PDF guarantee. The resume tailoring pipeline iterates through a budget ladder, optionally drops the ADDITIONAL section as a last resort, then runs a measurement-driven balance pass that re-renders with shifted margins so top/bottom whitespace is symmetric.
- **Smart text replacement** — When a tailoring suggestion proposes "Software Engineering Manager" instead of your existing "Software Development Manager", the app rewrites that phrase across every formatting boundary in your `.docx`, not just the Summary.

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| **Node.js** | 20+ | Runs the Next.js app and all server-side scrapers/scoring. |
| **LibreOffice** | 7.x or 26.x | Converts the edited `.docx` to PDF for the tailoring page-fit gate. The app shells out to `soffice --headless`. |
| **Git** | recent | Cloning the repo. |

Puppeteer (used for one of the careers scrapers) downloads a private Chromium build automatically during `npm install`; no separate browser install is needed.

### Installing the prerequisites

**macOS**
```bash
# Node 20+
brew install node

# LibreOffice
brew install --cask libreoffice
# verify
soffice --version
```

**Linux (Debian/Ubuntu)**
```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# LibreOffice
sudo apt-get install -y libreoffice
# verify
soffice --version
```

**Windows**

Install [Node.js LTS](https://nodejs.org/) and [LibreOffice](https://www.libreoffice.org/download/download/). Make sure `soffice.exe` is on your PATH (typically `C:\Program Files\LibreOffice\program`).

## Install

```bash
git clone https://github.com/dheerajkp10/job-app-assistant.git
cd job-app-assistant
npm install
npm run dev
```

Then open <http://localhost:3000>.

The very first `npm install` takes a couple of minutes because Puppeteer downloads its bundled Chromium. Subsequent installs are fast.

## First-time setup

The first visit to `http://localhost:3000` lands on a 6-step onboarding wizard:

1. **Role & Level** — pick the job families and seniority tiers you're searching for.
2. **Location** — preferred cities, remote / hybrid / onsite, and the country list you're authorized to work in (defaults to US).
3. **Salary** — total comp range, optional breakdown, or skip.
4. **Resume** — drag-and-drop a `.docx` (preferred) or `.pdf`. The tailoring engine needs `.docx` to make edits; PDF-only resumes can still be scored.
5. **Companies** — preview of every careers source the app will scan.
6. **Fetch Jobs** — kicks off the parallel SSE-driven fetcher. ~30–90s for the full set.

Once that finishes you're on the Job Listings page with live data. The dashboard, settings, and add-job pages are accessible from the top nav.

## How it stores your data

Everything is local under `./data/` (gitignored):

```
data/
├── db.json                # Settings, jobs[], listingsCache, scoreCache, listingFlags
├── resume/                # Uploaded resume (base + tailored copies)
├── listing-details/       # Cached job descriptions
└── tailored/              # Generated 1-page PDFs per role
```

There is no remote backend. Deleting `./data` resets the app to a fresh-install state.

## Updating the app

```bash
git pull
npm install        # picks up any new deps
npm run dev
```

If you've been using the app for a while, your `data/db.json` might be from an earlier schema. The app self-migrates idempotent fields (e.g. work-auth countries, scorer version) on first read; nothing should break.

## Production build (optional)

```bash
npm run build
npm run start      # serves on http://localhost:3000
```

The dev server (`npm run dev`) is plenty for personal use and gives you HMR on the source.

## Architecture (brief)

- **`src/app/`** — Next.js App Router pages + API routes.
- **`src/lib/sources.ts`** — The static list of company career sources (Greenhouse / Lever / Ashby tokens, Workday hosts, custom-fetcher slugs).
- **`src/lib/job-fetcher.ts`** + **`src/lib/custom-fetchers.ts`** — Per-ATS list/detail fetchers.
- **`src/lib/ats-scorer.ts`** — TF-weighted keyword scoring with Laplace smoothing. Versioned (`SCORER_VERSION`) so old cached scores are recomputed when the algorithm changes.
- **`src/lib/resume-suggestions.ts`** — Detector for the structural tailoring suggestions surfaced in the listings UI.
- **`src/lib/docx-editor.ts`** — Word-XML edits: skill-line append, summary append, bordered-section spacing, ADDITIONAL section removal, find/replace across formatting runs.
- **`src/lib/work-experience-injector.ts`** — Adds new bullets under the most-relevant Work Experience position.
- **`src/lib/pdf-bounds.ts`** — Hand-rolled PDF parser for the post-render whitespace-balance pass.

## Troubleshooting

**LibreOffice timeout when downloading a tailored PDF.**
The first conversion warms up LibreOffice's font cache and can take 10-15s. Subsequent conversions are <2s. If a render takes longer than 30s, kill any stuck `soffice` process:
```bash
pkill -f soffice
```

**`Could not fetch job details` on Apple / Amazon listings.**
Apple's careers site is the only source that uses Puppeteer. If the bundled Chromium failed to download, run:
```bash
npx puppeteer browsers install chrome
```
Amazon, Google, Microsoft, Meta, and Workday don't expose per-job detail endpoints, so they're flagged as "unscorable" and the app shows the listing without an ATS score. This is expected.

**Some companies show 0 jobs.**
The static source list is verified at commit time but board tokens occasionally rotate. Open `src/lib/sources.ts` and try alternate slugs, or open an issue.

**Resume tailoring overflows to 2 pages.**
The pipeline has a budget ladder + an "ADDITIONAL section removed" fallback tier. If your base resume is already tightly packed, the app serves the closest-to-1-page best-effort attempt and logs the budget tier that lost. Trim a bullet or two in your `.docx` and re-upload.

**The dev server hot-reloads but state seems stale.**
Settings + listings cache are server-side; reload the browser tab to re-fetch. The listings page also auto-revalidates on focus/visibility change.

## Contributing

PRs welcome — especially new careers sources. To add one:
1. Probe the company's career page for its ATS (most use Greenhouse / Lever / Ashby / Workday / Eightfold).
2. Add an entry to `src/lib/sources.ts` with the verified board token.
3. Run the app, hit "Refresh All", verify listings show up.
