/* eslint-disable */
/**
 * Injects a floating "Save to JobAssist" button on common career-board
 * job pages (LinkedIn, Indeed, Greenhouse, Lever, Ashby, Workday,
 * SmartRecruiters, Glassdoor). Click → asks the background worker
 * to POST the current URL to the user's local JobAssist server.
 *
 * Visual: small pill in the bottom-right corner. Avoids fighting
 * with the site's own DOM (no per-site selectors to maintain). Idle
 * z-index puts it under the site's own modals so it doesn't break
 * application flows.
 */
(function () {
  if (window.__jobassistInjected) return;
  window.__jobassistInjected = true;

  // Avoid injecting on LinkedIn's jobs *search* page — the button
  // only makes sense on individual postings. Heuristic: pathname
  // must contain '/jobs/view/' or '/viewjob' or similar.
  const path = window.location.pathname;
  const looksLikeJobPage =
    /\/jobs\/view\//.test(path) ||
    /\/viewjob/.test(path) ||
    /\/(careers|jobs)\/[a-z0-9-]+/i.test(path) ||
    /myworkdayjobs/.test(window.location.host) ||
    /smartrecruiters\.com/.test(window.location.host) ||
    /greenhouse\.io/.test(window.location.host) ||
    /lever\.co/.test(window.location.host) ||
    /ashbyhq\.com/.test(window.location.host);
  if (!looksLikeJobPage) return;

  // ─── Style + DOM ──────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.id = 'jobassist-capture-fab';
  wrap.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  `;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Save to JobAssist';
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 16px; border: 0; border-radius: 999px;
    font-size: 13px; font-weight: 600; color: white; cursor: pointer;
    background: linear-gradient(90deg, #6366F1, #8B5CF6);
    box-shadow: 0 8px 18px rgba(99,102,241,0.35);
    transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  `;
  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-1px)';
    btn.style.boxShadow = '0 12px 22px rgba(99,102,241,0.45)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = '';
    btn.style.boxShadow = '0 8px 18px rgba(99,102,241,0.35)';
  });

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: absolute; bottom: 50px; right: 0;
    padding: 8px 12px; border-radius: 8px;
    font-size: 12px; color: white;
    background: #0F172A; box-shadow: 0 6px 14px rgba(15,23,42,0.25);
    max-width: 320px; word-break: break-word;
    opacity: 0; transition: opacity 200ms ease;
    pointer-events: none;
  `;
  function showToast(msg, color = '#0F172A') {
    toast.style.background = color;
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    btn.style.opacity = '0.7';
    chrome.runtime.sendMessage(
      { kind: 'save-current-url', url: window.location.href },
      (resp) => {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.textContent = 'Save to JobAssist';
        if (!resp) {
          showToast('Extension background didn\'t respond.', '#9F1239');
          return;
        }
        if (resp.ok) {
          if (resp.alreadySaved) {
            showToast(`Already saved: ${resp.title ?? 'this listing'}.`, '#047857');
          } else {
            showToast(`Saved: ${resp.title ?? 'listing'} at ${resp.company ?? '?'}.`, '#047857');
          }
        } else {
          showToast(`Couldn't save — ${resp.error ?? 'unknown error'}.`, '#9F1239');
        }
      },
    );
  });

  wrap.appendChild(toast);
  wrap.appendChild(btn);
  // Wait for body to exist (some SPAs render late).
  function attach() {
    if (document.body) {
      document.body.appendChild(wrap);
    } else {
      setTimeout(attach, 100);
    }
  }
  attach();
})();
