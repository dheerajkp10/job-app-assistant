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
- **Auto-invalidation on resume upload** — uploading a new resume wipes the score cache, since cached scores were computed against the previous resume. The dashboard surfaces a **Rescore listings** banner that batch-rescores every scorable listing against the new resume in chunks of 25 with live progress; the listings page also lazy-rescores on view as a fallback.

### Salary intelligence
- **JD-only extraction (no third-party scraping)** — no Levels.fyi / Glassdoor calls. We read whatever the company posted; pay-transparency laws in WA / CA / CO / NY / MA / IL mean most US tech listings now carry an explicit range.
- The extractor detects:
  - Explicit **Base + Total Comp splits** (`"Base salary: $X – $Y. Total compensation: $A – $B."` → both ranges stored separately)
  - **OTE** annotations for sales roles → classified as TC
  - **Hourly rates** (`$X/hr`) → normalized to annual via × 2080
  - Multiple formats: `$XXXk – $XXXk`, `USD 250,000 – 350,000`, en/em dashes, `to` separators, comma-separated thousands, k/K/M suffixes
  - **Equity / RSU / stock-option mentions** as free-form hints (no false-precision parsing)
- Salary chips on listing cards show a rich tooltip with Base / Total Comp / Equity / source layer when the JD provides enough signal.
- **Backfill endpoint** (`POST /api/salary-intel/reprocess`) re-runs the parser across every cached listing using on-disk JD HTML — one button under **Settings → Salary Data Backfill** triggers it.
- **Peer-cohort statistics** (`p25 / median / p75`) derived from the user's own listings cache (no external API). Detail-fetched salaries persist back to the cache, so the cohort grows as you browse.

### Tailoring suggestions
- Structural fixes beyond just adding missing keywords: mirror the JD's role title, fill skills-line gaps, match years-of-experience claims, fold in distinctive multi-word JD phrases.
- Each suggestion is opt-in and applied à la carte. Same suggestions feed the multi-job optimizer.

### Tailored PDF output
- **Mandatory-mode tailoring (DEFAULT, since 2026-05-12)** — keywords come first, layout adapts. The server injects every keyword you selected unconditionally, then walks a compression cascade (margin tightening → paragraph spacing cuts → line-height reduction → body-font shrink → ADDITIONAL-section drop) until the rendered PDF lands on one page. Floors are enforced so the result stays readable: body font ≥ 9pt, margins ≥ 0.4", no destructive content drops (your Work Experience and Education stay intact). The UI shows a footer summarizing exactly which cascade steps fired (e.g. *Fit applied: margins 0.4", line height 1.05, body 10pt*).
- **Budget-ladder mode (opt-out)** — uncheck "Pack all keywords on 1 page" in the Tailor section to fall back to the legacy iterate-9-tiers behavior, which is more formatting-preserving but may drop keywords on tight resumes.
- **Whitespace balance pass** runs on every 1-page fit: measures actual rendered top/bottom whitespace and shifts the top margin so visible whitespace is symmetric.
- **Master Resume (general tailor)** — one button on the Dashboard generates a single resume tuned for broad ATS coverage across **every open listing matching your stored preferences** (role family, level, location, work mode, salary range, work-auth countries, excluded companies). Server-side stratified sampling caps the cohort at 100 listings, balanced across the user's target role families. The modal previews the auto-picked top-N keywords (slider 15–60, default 30), requires you to keep ≥ 15 before download, and runs the same mandatory-mode compression cascade. Endpoint: `POST /api/tailor-resume/general`.
- **Per-job tailor** (Listings page) — still available for targeted applications. Click any listing's Tailor button to optimize the resume for that specific JD with the same mandatory-mode cascade.
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
- **Top matching jobs** + **Top companies by ATS match** + **Resume performance** stats at a glance, each in a scrollable card sized to show ~5 entries.
- **Generate Master Resume** — opens the master-tailor modal. Analyzes every open listing matching your stored preferences (stratified-sampled, capped at 100), auto-selects top 30 missing keywords by frequency, lets you review/de-select, then runs the mandatory-mode compression cascade. Replaces the prior "Tailor for Top N" / "Optimize for general ATS" pair with a single unified flow.
- **Rescore banner** — surfaces when ≥ 20% of scorable listings are missing fresh ATS scores (typical state right after a resume upload). One click runs the existing batch-score endpoint in 25-listing chunks with live progress.

### Design language (2026-05 refresh)
- **Warm off-white** page background (`#FAF9F6`); pure white surfaces; **slate-100** card borders.
- **Indigo → Violet** gradient primary; **emerald / amber / rose** gradients for the ATS score tiers (Strong / Moderate / Weak); softened pipeline palette (indigo / sky / cyan / emerald / rose).
- **Three-tier button system**: gradient `lg` for the single primary CTA per page (Refresh All / Generate Master Resume / Save), soft `md` indigo / emerald for in-card actions, ghost `xs` for "View all →" navigation.
- **Card lift on hover** — `shadow-card` resting state, `shadow-card-hover` indigo-tinted glow with `-translate-y-0.5` on hover. Defined as utility classes in `src/app/globals.css` for centralized control.
- **Glass modal overlays** with `backdrop-blur-sm` and per-tier shadow tokens.
- **Portaled popovers** for the flag dropdown and the "N you know" badge so they escape card-level overflow clipping.

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

Then open one of:

- <http://localhost:3000> — always works, no setup needed.
- **<https://job-assist.dev:3000>** — fully branded URL, after a one-time setup below.

### Enable the branded URL

`.dev` is a real TLD on the HSTS preload list, so every browser forces HTTPS for any `.dev` domain. That means three things have to be set up locally:

1. A `/etc/hosts` entry mapping `job-assist.dev` → `127.0.0.1`
2. A **locally-trusted TLS cert** for the domain (since browsers refuse plain HTTP on `.dev`)
3. The dev server has to serve over HTTPS using that cert

A single `npm run setup-domain` handles all three.

**One-time prerequisite — install [mkcert](https://github.com/FiloSottile/mkcert):**

```bash
# macOS
brew install mkcert nss

# Linux (Debian/Ubuntu)
sudo apt install libnss3-tools mkcert

# Windows — see https://github.com/FiloSottile/mkcert#installation
```

mkcert is a small tool that creates a Certificate Authority on your machine and signs certs that your browser will trust. It's the standard dev-HTTPS solution and runs entirely offline.

**Then:**

```bash
npm run setup-domain
```

That:
- Adds `127.0.0.1   job-assist.dev` to `/etc/hosts` (asks for sudo once)
- Runs `mkcert -install` to put the local CA in your system trust store (asks for sudo once, idempotent)
- Generates `./certs/cert.pem` + `./certs/key.pem` for `job-assist.dev`

After that, `npm run dev` auto-detects the certs and boots in HTTPS mode. Visit **<https://job-assist.dev:3000>** and your browser will show a trusted padlock, the tab reads **"JobAssist"**, and the URL is fully branded.

#### Choose a different domain

If you'd rather not shadow the registered `job-assist.dev`, pass any name:

```bash
npm run setup-domain job-assist.test   # IETF-reserved for testing, safest
npm run setup-domain my-job-tracker.local
npm run setup-domain anything.you.want
```

Non-`.dev` domains don't require HTTPS, but the script generates a cert anyway so the experience is consistent.

#### Undo

```bash
# Remove /etc/hosts entry
sudo sed -i '' '/# JobAssist local dev/d' /etc/hosts   # macOS
sudo sed -i      '/# JobAssist local dev/d' /etc/hosts # Linux

# Remove the local certs (dev server falls back to plain HTTP)
rm -rf certs/

# Optional: fully remove the local CA from your system trust store
mkcert -uninstall
```

`localhost:3000` keeps working regardless of whether the entry / certs are present.

The very first `npm install` takes a couple of minutes because Puppeteer downloads its bundled Chromium. Subsequent installs are fast.

### Health check

The app probes for LibreOffice on every page load and shows a banner if `soffice` isn't on the PATH. You can also hit:

```bash
curl http://localhost:3000/api/health
# or (after `npm run setup-domain`):
curl https://job-assist.dev:3000/api/health --cacert certs/cert.pem
```

…to see the raw probe result (LibreOffice version + platform).

## First-time setup

The first visit (to either <http://localhost:3000> or, after `npm run setup-domain`, <https://job-assist.dev:3000>) lands on a 6-step onboarding wizard:

1. **Role & Level** — pick the job families and seniority tiers you're searching for.
2. **Location** — preferred cities, remote / hybrid / onsite, and the country list you're authorized to work in (defaults to US).
3. **Salary** — total comp range, optional breakdown, or skip.
4. **Resume** — drag-and-drop a `.docx` (preferred) or `.pdf`. The tailoring engine needs `.docx` to make edits; PDF-only resumes can still be scored.
5. **Companies** — preview of every careers source the app will scan. Add custom sources from the Settings page after onboarding.
6. **Fetch Jobs** — kicks off the parallel SSE-driven fetcher. ~30–90s for the full set.

Once that finishes you're on the Job Listings page with live data. The top nav exposes Dashboard, Listings, Pipeline, Compare, Add Job, and Settings.

## Day-to-day workflow

The canonical loop after onboarding:

1. **Refresh listings** (`Listings → Refresh All`) — pulls the latest job postings across every configured source. The streaming progress card shows per-company status; the rest of the UI stays usable.
2. **Filter** down to roles you'd actually apply to (role family, level, location, salary, work-mode, date-posted). Save the filter set as a named preset for reuse.
3. **Browse + flag**: open promising listings, hit the per-card **Tailor My Resume** for per-job optimization, or scroll through and just check ATS scores at a glance. Use the flag dropdown (Applied / Phone Screen / Interviewing / Offer / Rejected) to track pipeline state.
4. **Generate Master Resume** from the Dashboard once you've got 50+ matching listings — produces a single resume tuned for broad ATS coverage across your target market. Auto-picks top 30 keywords by frequency, lets you de-select anything you can't legitimately claim, then bakes them in via the mandatory-mode compression cascade. Download → re-upload as your new base via `Settings → Upload Resume`.
5. **Rescore** — after uploading a new resume, the Dashboard surfaces a violet **Rescore listings** banner. One click batch-scores everything against the new resume so the averages reflect reality.
6. **Track pipeline** on the `Pipeline` Kanban page; export a Markdown **Status report** when you want to share progress with a mentor / coach.
7. **Cover letter + outreach** generated on demand from any listing's detail view, using your resume's strongest signals (years of experience, current employer, top quantified achievement) + the JD's mission sentence.

The whole loop runs locally — your resume, your network, your application history, everything in `./data/`. No external calls except the public career-board APIs.

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
npm run start      # serves on http://localhost:3000 (HTTPS in dev requires `npm run dev`)
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

**Tailoring**
- `POST /api/tailor-resume` — single-job tailor; mandatory mode (default) injects all user-selected keywords + runs compression cascade. Optional `mode: 'budget-ladder'` for the legacy iterate-9-tiers behavior.
- `POST /api/tailor-resume/multi` — explicit-listing multi-tailor with tier-0 user-selection budget. Cap raised to 100 listings.
- `POST /api/tailor-resume/general` — Master Resume: server-side preference filtering + stratified sampling, forwards to `/multi` for aggregation + render.
- `POST /api/tailor-resume/stream` — SSE-progress variant for long-running per-job tailors.

**Scoring + salary**
- `POST /api/ats-score` — score a single listing against the current resume.
- `POST /api/ats-score/batch` — score N listings at once (used by the dashboard Rescore banner).
- `GET /api/scores-cache` — read every cached score; filters out entries from older scorer versions client-side.
- `GET /api/salary-intel?listingId=...` — peer-cohort `p25 / median / p75` for the listing's role family + location bucket.
- `POST /api/salary-intel/reprocess` — backfill: re-runs the salary parser against every cached listing's on-disk JD HTML, populates Base / TC / equity-hint fields.

**Job data**
- `GET /api/listings` — read the listings cache.
- `GET /api/listings/[listingId]` — fetch + persist full JD detail. Side-effect: re-runs salary parser on the fresh body.
- `POST /api/listings/fetch-stream` — SSE-driven refresh across every configured source.
- `POST /api/extract-job` — parse a single posting URL into title/company/location/JD.

**Workflow**
- `GET|POST /api/listing-flags` — per-listing flags (Applied / Phone Screen / Interviewing / Offer / Rejected / Incorrect / Not Applicable).
- `GET /api/status-report` — Markdown pipeline export.
- `GET|POST|DELETE /api/reminders` — per-listing reminder store.

**Integrations**
- `GET|POST|DELETE /api/network` — LinkedIn connections store; POST accepts multi-file uploads of `.csv` or LinkedIn `.zip`.
- `GET|POST|PUT|DELETE /api/sources` — user-added custom sources.
- `POST /api/cover-letter` — deterministic generator.
- `POST /api/interview-prep` — prep packet.
- `POST /api/outreach` — recruiter note.

**Settings + meta**
- `GET|PUT /api/settings` — user preferences.
- `GET|POST /api/resume` — resume upload (POST clears the score cache on text change).
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
Salary cohorts need ≥3 peers in the same role family + location bucket with parsed `salaryMin`/`salaryMax`. Greenhouse list-fetches use `?content=true` (so most boards extract salary at list time), Ashby falls back to description text when `compensationTierSummary` is empty, and detail fetches persist salary back to cache. To backfill in one shot: **Settings → Salary Data Backfill → Reprocess salary data**. Browse more listings and the cohort grows.

**Dashboard still shows my old ATS score after uploading a new resume.**
Fixed — the `/api/resume` POST now wipes the score cache when the parsed text changes, since cached scores were computed against the previous resume. The dashboard surfaces a **Rescore listings** banner that batch-rescores everything against the new resume in chunks of 25. The listings page also lazy-rescores on view, so opening `/listings` after the upload achieves the same end state more slowly.

**"At most 25 listings can be tailored at once" when running Generate Master Resume.**
Fixed — the `/multi` cap is now 100 to match the Master Resume sample size.

**Some companies show 0 jobs.**
The static source list is verified at commit time but board tokens occasionally rotate. Open `src/lib/sources.ts` and try alternate slugs, or add the company as a Custom Source from Settings.

**Resume tailoring overflows to 2 pages.**
Mandatory mode (the default) injects every selected keyword and then walks a compression cascade (margins → paragraph spacing → line height → body font → drop ADDITIONAL section) to fit on one page. Floors: body ≥ 9pt, margins ≥ 0.4". If your base resume is already tightly packed enough that even max compression overflows, the UI shows an amber **"Couldn't fit on 1 page"** footer naming the steps that were tried, and ships the best-effort multi-page anyway (so your keywords aren't lost). To force a 1-page result: deselect a few low-frequency keywords or trim a bullet in your `.docx` and re-upload.

**I want the old keyword-pruning behavior back.**
Uncheck **"Pack all keywords on 1 page (aggressive)"** in the listings Tailor section (or the multi-tailor modal). That switches the request to `mode: 'budget-ladder'`, restoring the legacy 9-tier iterate-and-drop-keywords behavior.

**Hydration mismatch warnings in the console.**
The known offenders have been fixed (notably the LinkedIn network panel's `webkitdirectory` attribute, now attached imperatively after mount). If you see new ones, check whether a browser extension is injecting attributes (Grammarly, Dark Reader, 1Password, translation extensions) — try in Incognito to confirm.

**The "N you know" popover is hidden behind other listing cards.**
Fixed — the popover is now portaled to `document.body` with fixed coordinates from `getBoundingClientRect`, so it escapes any ancestor `overflow: hidden` clip. Same pattern as the flag dropdown.

**The design preview page at `/design-preview` is gone.**
Intentional. It was a one-time sandbox for picking the design direction. The live UI now embodies that direction, and the route was removed in commit `95027f9`. Earlier commits (`436d26e`, `da1d1b1`) hold the sandbox source if you want to inspect it.

**The dev server hot-reloads but state seems stale.**
Settings + listings cache are server-side; reload the browser tab to re-fetch. The listings and pipeline pages also auto-revalidate on focus/visibility change.

## Contributing

PRs welcome — especially new careers sources. To add one:
1. Probe the company's career page for its ATS (most use Greenhouse / Lever / Ashby / Workday / Eightfold / SmartRecruiters).
2. Either add an entry to `src/lib/sources.ts` with the verified board token, or use the **Custom Sources** UI in Settings to add it at runtime.
3. Run the app, hit "Refresh All", verify listings show up.
4. If the source has a per-job detail endpoint, wire it into `fetchJobDetail()` so the listing becomes scoreable.
