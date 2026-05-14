/* eslint-disable */
/**
 * Background service worker for JobAssist Capture.
 *
 * Receives "save-current-url" messages from the content script,
 * resolves the user's configured endpoint (default localhost:3000),
 * and runs the same two-step extract → add flow the popup uses.
 *
 * Lives in the background so the content script doesn't need
 * host_permissions for the local API endpoint (it'd be flagged as
 * a CORS request from the third-party site). The service worker
 * has those host permissions and can fetch freely.
 */

const DEFAULT_ENDPOINT = 'http://localhost:3000';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind !== 'save-current-url' || !msg?.url) return;
  (async () => {
    try {
      const endpoint = await loadEndpoint();
      const extract = await fetch(`${endpoint}/api/extract-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: msg.url }),
      });
      if (!extract.ok) {
        const txt = await extract.text().catch(() => '');
        sendResponse({ ok: false, error: `extract-job HTTP ${extract.status}: ${txt.slice(0, 80)}` });
        return;
      }
      const data = await extract.json();
      if (data.match) {
        sendResponse({
          ok: true,
          alreadySaved: true,
          title: data.match.title,
          company: data.match.company,
        });
        return;
      }
      if (data.error) {
        sendResponse({ ok: false, error: data.error });
        return;
      }
      const add = await fetch(`${endpoint}/api/listings/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: data.company ?? 'Unknown Company',
          title: data.title ?? 'Untitled Role',
          location: data.location ?? 'Not specified',
          url: msg.url,
          description: data.description ?? '',
          portal: data.portal ?? 'other',
        }),
      });
      if (!add.ok) {
        const txt = await add.text().catch(() => '');
        sendResponse({ ok: false, error: `listings/add HTTP ${add.status}: ${txt.slice(0, 80)}` });
        return;
      }
      sendResponse({
        ok: true,
        title: data.title,
        company: data.company,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error: msg });
    }
  })();
  return true; // signal async sendResponse
});

async function loadEndpoint() {
  try {
    const v = await chrome.storage.local.get(['endpoint']);
    return (v.endpoint && typeof v.endpoint === 'string') ? v.endpoint : DEFAULT_ENDPOINT;
  } catch {
    return DEFAULT_ENDPOINT;
  }
}
