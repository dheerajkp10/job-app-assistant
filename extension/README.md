# JobAssist Capture (browser extension)

One-click save from LinkedIn / Indeed / Greenhouse / Lever / Ashby / Workday / SmartRecruiters / Glassdoor straight into your local JobAssist tracker — no copy/paste.

## What it does

- Adds a small **"Save to JobAssist"** floating button on supported job pages.
- Click the button (or the toolbar icon) → the current URL is sent to your local JobAssist server (`http://localhost:3000` by default), which extracts title / company / location / JD body and adds the listing to your cache.
- If you've already saved the same URL, the extension says "already saved" and skips creating a duplicate.

## Supported sites

| Site | URL pattern |
|---|---|
| LinkedIn | `linkedin.com/jobs/*` |
| Indeed | `indeed.com/viewjob*` |
| Greenhouse | `boards.greenhouse.io/*` and `job-boards.greenhouse.io/*` |
| Lever | `jobs.lever.co/*` |
| Ashby | `jobs.ashbyhq.com/*` |
| Workday | `*.myworkdayjobs.com/*` |
| SmartRecruiters | `careers.smartrecruiters.com/*`, `jobs.smartrecruiters.com/*` |
| Glassdoor | `glassdoor.com/job-listing/*`, `glassdoor.com/Job/*` |

Other career pages: open the popup (toolbar icon) on any tab — the popup grabs the current URL and works the same way.

## Install (developer mode)

The extension isn't on the Chrome Web Store / Firefox Add-ons (yet). Load it locally:

### Chrome / Edge / Brave / Arc

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select this `extension/` directory.
5. The JobAssist Capture icon should appear in your toolbar. Pin it for convenience.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `extension/manifest.json`.
4. The extension stays loaded until Firefox restarts.

For a persistent install in Firefox, the manifest needs to be packaged + signed via [web-ext](https://github.com/mozilla/web-ext) and Mozilla's add-on signing service. Out of scope for this dev-mode setup.

## Requirements

- Your **JobAssist dev server must be running** (`npm run dev` in the main project) on `http://localhost:3000`. The extension talks to it directly — there's no remote backend.
- The popup has a small dot indicator: green = dev server reachable, red = not running.

## Changing the endpoint

If you run the dev server on a different port:

1. Click the extension icon (toolbar).
2. Type the new base URL in the endpoint field (e.g. `http://localhost:4000`).
3. Click **Save**.

The value is persisted in `chrome.storage.local`, so you only set it once.

## Troubleshooting

**The floating button doesn't appear on a job page.**
The content-script `matches` list is conservative — it only injects on URLs that *look* like job postings (e.g. LinkedIn `/jobs/view/`, Indeed `/viewjob`). On a site that's not matched, use the toolbar-icon popup instead.

**"Couldn't reach `http://localhost:3000`"**
Your dev server isn't running. Start it (`npm run dev` in the main project) and try again. The popup's green/red dot is a live health check.

**Extension says "Saved" but the listing isn't on the Listings page.**
Open `/listings` and refresh — the page reads from the listing cache on mount, and a manual save doesn't push to open tabs. Once cached, it's permanent.

**"Already saved" but I want to re-extract.**
The dedup is on URL match. Either visit the existing listing in JobAssist (the extension's "Open Listings" link), or delete the cached entry and re-save.

## What the extension does NOT do

- It doesn't send anything to a remote server. Everything stays between your browser and `localhost`.
- It doesn't auto-apply or auto-fill forms.
- It doesn't read your network / contacts / personal data.
- It doesn't store credentials.
