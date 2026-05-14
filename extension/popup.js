/* eslint-disable */
/**
 * Popup logic. Reads the active tab URL, calls the user's local
 * JobAssist server in two steps:
 *   1) POST /api/extract-job  { url }                       → parses JD
 *   2) POST /api/listings/add { company, title, location… } → adds to cache
 * Result + any error messages are surfaced inline. The endpoint base
 * URL is editable + persisted in chrome.storage.local so users on
 * non-default ports still work.
 */

const DEFAULT_ENDPOINT = 'http://localhost:3000';

const urlPreview = document.getElementById('url-preview');
const saveBtn = document.getElementById('save-btn');
const saveLabel = document.getElementById('save-label');
const statusEl = document.getElementById('status');
const endpointInput = document.getElementById('endpoint');
const endpointSave = document.getElementById('endpoint-save');
const healthDot = document.getElementById('health-dot');

let currentTabUrl = '';
let endpoint = DEFAULT_ENDPOINT;

// ─── Init: read tab + endpoint, probe health ───────────────────────
(async () => {
  endpoint = await loadEndpoint();
  endpointInput.value = endpoint;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    currentTabUrl = tab.url;
    urlPreview.textContent = currentTabUrl;
    saveBtn.disabled = false;
  } else {
    urlPreview.textContent = '(no active tab)';
  }
  probeHealth();
})();

saveBtn.addEventListener('click', async () => {
  if (!currentTabUrl) return;
  setBusy(true);
  setStatus(null);
  try {
    // 1. Extract — server reads the URL, fetches, and pulls metadata
    //    via the same Readability path /jobs/add uses.
    const extractRes = await fetch(`${endpoint}/api/extract-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentTabUrl }),
    });
    if (!extractRes.ok) {
      const txt = await extractRes.text().catch(() => '');
      throw new Error(`extract-job failed (HTTP ${extractRes.status}). ${txt.slice(0, 120)}`);
    }
    const extracted = await extractRes.json();

    // Pre-dedup: server returns `match` when the URL is already in
    // the cache. Surface that and short-circuit.
    if (extracted.match) {
      setStatus(
        `Already saved as <strong>${escapeHtml(extracted.match.company)} — ${escapeHtml(extracted.match.title)}</strong>. <a href="${endpoint}/listings" target="_blank">Open Listings</a>`,
        'ok',
      );
      return;
    }
    if (extracted.error) throw new Error(extracted.error);

    // 2. Add to listings cache. extract-job returns { title, company,
    //    location, description, portal }. Pass all through.
    const addRes = await fetch(`${endpoint}/api/listings/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: extracted.company ?? 'Unknown Company',
        title: extracted.title ?? 'Untitled Role',
        location: extracted.location ?? 'Not specified',
        url: currentTabUrl,
        description: extracted.description ?? '',
        portal: extracted.portal ?? 'other',
      }),
    });
    if (!addRes.ok) {
      const txt = await addRes.text().catch(() => '');
      throw new Error(`listings/add failed (HTTP ${addRes.status}). ${txt.slice(0, 120)}`);
    }

    setStatus(
      `Saved <strong>${escapeHtml(extracted.company ?? 'Unknown')} — ${escapeHtml(extracted.title ?? 'Untitled')}</strong>. <a href="${endpoint}/listings" target="_blank">Open Listings</a>`,
      'ok',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/fetch/i.test(msg) || /Failed/i.test(msg) || /NetworkError/i.test(msg)) {
      setStatus(
        `Couldn't reach <code>${escapeHtml(endpoint)}</code>. Make sure your local JobAssist dev server is running (<code>npm run dev</code>).`,
        'err',
      );
    } else {
      setStatus(`Error: ${escapeHtml(msg)}`, 'err');
    }
  } finally {
    setBusy(false);
  }
});

endpointSave.addEventListener('click', async () => {
  const next = (endpointInput.value || '').trim().replace(/\/+$/, '');
  if (!next) return;
  endpoint = next;
  await saveEndpoint(next);
  probeHealth();
  setStatus(`Endpoint set to <code>${escapeHtml(next)}</code>`, 'ok');
});

async function probeHealth() {
  healthDot.classList.remove('ok', 'err');
  healthDot.classList.add('unknown');
  try {
    const res = await fetch(`${endpoint}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    healthDot.classList.remove('unknown', 'err');
    healthDot.classList.add('ok');
    healthDot.title = 'Dev server reachable';
  } catch {
    healthDot.classList.remove('unknown', 'ok');
    healthDot.classList.add('err');
    healthDot.title = `Dev server unreachable at ${endpoint}`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function setBusy(busy) {
  saveBtn.disabled = busy;
  saveLabel.textContent = busy ? 'Saving…' : 'Save to JobAssist';
}

function setStatus(html, kind) {
  if (!html) {
    statusEl.innerHTML = '';
    statusEl.className = '';
    return;
  }
  statusEl.className = `status ${kind || ''}`;
  statusEl.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadEndpoint() {
  try {
    const v = await chrome.storage.local.get(['endpoint']);
    return (v.endpoint && typeof v.endpoint === 'string') ? v.endpoint : DEFAULT_ENDPOINT;
  } catch {
    return DEFAULT_ENDPOINT;
  }
}
async function saveEndpoint(value) {
  try { await chrome.storage.local.set({ endpoint: value }); } catch {}
}
