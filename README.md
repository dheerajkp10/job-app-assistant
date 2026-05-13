# Job Application Assistant

A local-first web app for tracking and improving job applications. It pulls live listings from 70+ tech-company career APIs, scores your resume against each one, produces a tailored 1-page PDF resume per role, and tracks every step from "interesting" to "offer" — all running on your laptop, with your data staying on your laptop.

> No SaaS account, no API key, no remote server. The app boots in ~10 seconds and uses Next.js 16 + a JSON file under `data/` as its database.

## What it does

### Live job aggregation
- Pulls openings from **Greenhouse**, **Lever**, **Ashby**, **Workday**, **Eightfold**, **SmartRecruiters**, and a half-dozen company-specific APIs (Apple, Amazon, Google, Microsoft, Meta, Uber, …) into a single searchable dashboard.
- **Custom sources UI** — add any company's careers board at runtime by pasting the URL; the app auto-detects the ATS and starts fetching on the next refresh.
- **Streaming refresh** — Server-Sent-Events progress bar shows per-company fetch status; the rest of the app stays interactive while the background sync runs.

### Smart filters
- Role family, level (EM1 → VP), location, work mode, salary range, ATS score range, work-authorization countries, excluded companies, and date-posted (today / 24h / 2 days / week / month).
- **Synonym-aware location matching** — recognizes US country aliases (US / USA / U.S. / United States), airport codes (SEA, SFO, NYC, LAX, …), state code ↔ name conversions, and remote-friendly combinations of `workMode` + `workAuthCountries`. "Seattle, WA" + Remote will catch listings like `"US-SEA"`, `"USA - Remote"`, `"U.S. Remote"`, `"Remote - All locations"`.
- **Saved filter presets** — name and persist your favorite filter combinations (e.g. "EM Seattle ≥70%", "Staff IC remote ≥80%").

### ATS keyword scoring
- TF-weighted Laplace-smoothed scorer with **JD-bigram phrase coverage** (v3) so multi-word matches like "distributed systems" or "incident response" actually count.
- Per-listing breakdown: technical / management / domain / soft + phrase coverage.
- Versioned cache — when the scoring algorithm bumps (v2 → v3), older entries are invalidated and silently recomputed.
- **Salary intelligence** — derives `p25 / median / p75` for the role family + location bucket from your own listings cache (no external API). Detail-fetched salaries persist back to the cache, so the cohort grows as you browse.

### Tailoring suggestions
- Structural fixes beyond just adding missing keywords: mirror the JD's role title, fill skills-line gaps, match years-of-experience claims, fold in distinctive multi-word JD phrases.
- Each suggestion is opt-in and applied à la carte. Same suggestions feed the multi-job optimizer.

### Tailored PDF output
- **One-page PDF guarantee** via a budget ladder. Iterates through up to 9 budget tiers, optionally drops the ADDITIONAL section as a last resort, then runs a measurement-driven balance pass that re-renders with shifted margins so top/bottom whitespace is symmetric.
- **User-selection budget tier 0** — when you explicitly pick keywords to include, the first attempt honors your full selection at face value. Lower tiers only kick in if the page-fit gate fails.
- **Multi-job tailor** — generate one resume that targets your top-20 (or pipeline-flagged) jobs simultaneously, with cross-job keyword frequency ranking.
- **Smart text replacement** — when a tailoring suggestion proposes "Software Engineering Manager" instead of your existing "Software Development Manager", the app rewrites that phrase across every formatting boundary in your `.docx`, not just the Summary.

### Application pipeline (Kanban)
- Five-column board: **Applied → Phone Screen → Interviewing → Offer → Rejected**. Flag any listing from the listings page; it appears as a card on the pipeline.
- Move-left / move-right arrows on each card; clicking the trash removes it from the board (but not from listings).
- One-click **Status report** export — Markdown summary of every active application, suitable for sharing with a coach or mentor.

### Cover letters & outreach
- **Deterministic cover-letter generator** — pulls the highest-signal pieces from your resume (years of experience, current employer, team scale, top quantified achievement) plus the JD's mission sentence and your top matched JD keywords to assemble a 3-paragraph draft. Edit inline or download as `.txt`.
- **Outreach email generator** — short hiring-manager-style notes leveraging the same signal extraction.
- **Interview prep packets** — JD-keyed talking points, likely questions, and "things to ask" lists generated per listing.

### LinkedIn network awareness
- Import your LinkedIn `Connections.csv` (or the raw `.zip` export — we unzip it server-side). **Multi-file sequential upload supported**: drop both `Basic_LinkedInDataExport_*.zip` and `Complete_LinkedInDataExport_*.zip` separately, or pick from different folders one at a time; the queue stages them and one Upload click merges everything.
- Listing cards show a clickable **"N you know"** badge when your network has contacts at that company. Click to expand a popover with names, current positions, and one-click LinkedIn profile links.
- Stored locally; never sent anywhere.

### Compare view
- Side-by-side comparison of 2–3 listings (work mode, salary range, posted date, ATS score with category breakdown, JD phrase coverage).
- **Same-company callout** — when all selected listings share a company, the banner highlights this so you're comparing role-level (not company-level) distinctions.

### Reminders
- Per-listing reminders backed by the browser's Notification API + a polling effect. No email service, no cron.

### Dashboard
- **Top matching jobs** + **Top companies by ATS match** + **Resume performance** stats at a glance.
- **Tailor for Top N Jobs** — opens the multi-tailor modal seeded with your top-scoring listings.
- **Optimize for general ATS** — same modal seeded with your pipeline-flagged jobs (the ones you're *actually* pursuing); best-overlap keywords across those specifically.

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

### Health check

The app probes for LibreOffice on every page load and shows a banner if `soffice` isn't on the PATH. You can also hit:

```bash
curl http://localhost:3000/api/health
```

…to see the raw probe result (LibreOffice version + platform).

## First-time setup

The first visit to `http://localhost:3000` lands on a 6-step onboarding wizard:

1. **Role & Level** — pick the job families and seniority tiers you're searching for.
2. **Location** — preferred cities, remote / hybrid / onsite, and the country list you're authorized to work in (defaults to US).
3. **Salary** — total comp range, optional breakdown, or skip.
4. **Resume** — drag-and-drop a `.docx` (preferred) or `.pdf`. The tailoring engine needs `.docx` to make edits; PDF-only resumes can still be scored.
5. **Companies** — preview of every careers source the app will scan. Add custom sources from the Settings page after onboarding.
6. **Fetch Jobs** — kicks off the parallel SSE-driven fetcher. ~30–90s for the full set.

Once that finishes you're on the Job Listings page with live data. The top nav exposes Dashboard, Listings, Pipeline, Compare, Add Job, and Settings.

## Adding a job manually

The **Add Job** page accepts:
- A direct URL to a posting → the extractor uses Readability + per-ATS heuristics to pull title, company, location, description.
- Or a plain-text paste of the job description.

Either way the listing lands in the cache and is scored against your resume immediately.

## Importing your LinkedIn network

In **Settings → Network (LinkedIn import)**:

1. Get the export from LinkedIn → Me → Settings → Data privacy → Get a copy of your data → Connections.
2. LinkedIn may email you the export as multiple `.zip` parts. Both parts are supported.
3. Click **Add a file** (or drag-and-drop) — each click stages one file in the queue. Repeat for files in different folders, then click **Upload N files**.
4. Files with the same name (e.g. both parts' `Connections.csv`) are distinguished by size + modified-date and an amber `#1 of 2` badge.
5. The server unzips `.zip` archives automatically, dedupes connections by LinkedIn profile URL, and merges with anything already imported.

To replace the stored network entirely, click **Clear all** first, then upload.

## How it stores your data

Everything is local under `./data/` (gitignored):

```
data/
├── db.json                # Settings, jobs[], listingsCache, scoreCache, listingFlags,
│                          # reminders, network, custom sources
├── resume/                # Uploaded resume (base + tailored copies)
├── listing-details/       # Cached job descriptions (per-listing HTML)
└── tailored/              # Generated 1-page PDFs per role
```

There is no remote backend. Deleting `./data` resets the app to a fresh-install state.

## Updating the app

```bash
git pull
npm install        # picks up any new deps
npm run dev
```

If you've been using the app for a while, your `data/db.json` might be from an earlier schema. The app self-migrates idempotent fields (work-auth countries, scorer version, pipeline flag values, etc.) on first read; nothing should break. Stale scores from an older `SCORER_VERSION` are hidden client-side and silently recomputed.

## Production build (optional)

```bash
npm run build
npm run start      # serves on http://localhost:3000
```

The dev server (`npm run dev`) is plenty for personal use and gives you HMR on the source.

## Architecture (brief)

### Pages
- `src/app/dashboard/` — overview, top-jobs, multi-tailor entry points.
- `src/app/listings/` — main browse + filter + per-card score/tailor/flag UI.
- `src/app/pipeline/` — five-column Kanban board over pipeline flags.
- `src/app/compare/` — 2–3-up side-by-side.
- `src/app/jobs/add/` — manual entry from URL or pasted JD.
- `src/app/settings/` — preferences, resume, custom sources, LinkedIn network import.

### Libraries
- `src/lib/sources.ts` — static list of company career sources (Greenhouse / Lever / Ashby tokens, Workday hosts, custom-fetcher slugs). `getAllSources()` unions static + user-added.
- `src/lib/job-fetcher.ts` + `src/lib/custom-fetchers.ts` — per-ATS list/detail fetchers. Greenhouse list now uses `?content=true` so salary can be extracted at list-time.
- `src/lib/puppeteer-fetchers.ts` — headless-browser fallback for Apple/Meta where the JSON endpoints have shifted.
- `src/lib/ats-scorer.ts` — TF-weighted keyword scoring with Laplace smoothing + JD-bigram phrase coverage. Versioned (`SCORER_VERSION`) so old cached scores are recomputed when the algorithm changes.
- `src/lib/location-match.ts` — synonym-aware location matcher with airport codes, state aliases, and remote-friendly fallbacks.
- `src/lib/salary-intelligence.ts` — per-role / per-bucket salary stats from the user's own cache.
- `src/lib/salary-parser.ts` — extracts USD ranges from JD bodies; used by every fetcher that has access to description text.
- `src/lib/resume-suggestions.ts` — detector for the structural tailoring suggestions surfaced in the listings UI.
- `src/lib/cover-letter.ts` — deterministic 3-paragraph generator with years-of-experience, current-company, scale-signal, and JD mission-sentence extraction.
- `src/lib/interview-prep.ts` — JD-keyed prep packets.
- `src/lib/outreach-email.ts` — recruiter-style note generator.
- `src/lib/docx-editor.ts` — Word-XML edits: skill-line append, summary append, bordered-section spacing, ADDITIONAL section removal, find/replace across formatting runs.
- `src/lib/work-experience-injector.ts` — adds new bullets under the most-relevant Work Experience position.
- `src/lib/pdf-bounds.ts` — hand-rolled PDF parser for the post-render whitespace-balance pass.

### API routes (selected)
- `POST /api/tailor-resume` — single-job tailor + budget ladder + balance pass.
- `POST /api/tailor-resume/multi` — cross-job multi-tailor with tier-0 user-selection budget.
- `POST /api/tailor-resume/stream` — SSE-progress variant for long-running tailors.
- `GET /api/salary-intel?listingId=...` — peer-cohort salary stats.
- `GET|POST|DELETE /api/network` — LinkedIn connections store; POST accepts multi-file uploads of `.csv` or `.zip`.
- `GET|POST|PUT|DELETE /api/sources` — user-added custom sources.
- `POST /api/cover-letter` — deterministic generator.
- `POST /api/interview-prep` — prep packet.
- `POST /api/outreach` — recruiter note.
- `GET|POST|DELETE /api/reminders` — per-listing reminder store.
- `GET /api/status-report` — Markdown pipeline export.
- `GET /api/health` — LibreOffice + platform probe.

## Troubleshooting

**LibreOffice timeout when downloading a tailored PDF.**
The first conversion warms up LibreOffice's font cache and can take 10-15s. Subsequent conversions are <2s. If a render takes longer than 30s, kill any stuck `soffice` process:
```bash
pkill -f soffice
```

**`Could not fetch job details` on Apple / Amazon / Meta listings.**
Apple uses Puppeteer; if its bundled Chromium failed to download, run:
```bash
npx puppeteer browsers install chrome
```
Amazon, Microsoft, and Workday don't expose per-job detail endpoints, so they're flagged as "unscorable" and the app shows the listing without an ATS score. This is expected.

**Listing flagged as `Rejected` doesn't appear on the Kanban board.**
Fixed — the listing-flags route previously allowlisted only triage flags; pipeline flags (`phone-screen`, `interviewing`, `offer`, `rejected`) now persist correctly.

**Multi-tailor seems to drop keywords I selected.**
Fixed — a new tier-0 budget in the multi-tailor ladder honors your full selection on the first attempt. Lower tiers only trigger if the page-fit gate fails.

**Salary intel only appears on some listings.**
Salary cohorts need ≥3 peers in the same role family + location bucket with parsed `salaryMin`/`salaryMax`. Greenhouse list-fetches now use `?content=true` (so most boards extract salary at list time), Ashby falls back to description text when `compensationTierSummary` is empty, and detail fetches persist salary back to cache. Browse more listings and the cohort grows.

**Some companies show 0 jobs.**
The static source list is verified at commit time but board tokens occasionally rotate. Open `src/lib/sources.ts` and try alternate slugs, or add the company as a Custom Source from Settings.

**Resume tailoring overflows to 2 pages.**
The pipeline has a budget ladder + "ADDITIONAL section removed" fallback. If your base resume is already tightly packed, the app serves the closest-to-1-page best-effort attempt and logs the budget tier that lost. Trim a bullet or two in your `.docx` and re-upload.

**Hydration mismatch warnings in the console.**
The known offenders have been fixed (notably the LinkedIn network panel's `webkitdirectory` attribute, now attached imperatively after mount). If you see new ones, check whether a browser extension is injecting attributes (Grammarly, Dark Reader, 1Password, translation extensions) — try in Incognito to confirm.

**The dev server hot-reloads but state seems stale.**
Settings + listings cache are server-side; reload the browser tab to re-fetch. The listings and pipeline pages also auto-revalidate on focus/visibility change.

## Contributing

PRs welcome — especially new careers sources. To add one:
1. Probe the company's career page for its ATS (most use Greenhouse / Lever / Ashby / Workday / Eightfold / SmartRecruiters).
2. Either add an entry to `src/lib/sources.ts` with the verified board token, or use the **Custom Sources** UI in Settings to add it at runtime.
3. Run the app, hit "Refresh All", verify listings show up.
4. If the source has a per-job detail endpoint, wire it into `fetchJobDetail()` so the listing becomes scoreable.
