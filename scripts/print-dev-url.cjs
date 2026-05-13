#!/usr/bin/env node
/* eslint-disable no-console */
// Friendly banner printed after `npm install` so the user knows
// what local URL to bookmark instead of plain http://localhost:3000.
// `localtest.me` is a public DNS-wildcard zone whose A record is
// 127.0.0.1 — no /etc/hosts edits required, just works offline once
// the resolver caches it.
const url = 'http://jobassist.localtest.me:3000';
const local = 'http://localhost:3000';
const bar = '[35m';   // magenta
const reset = '[0m';
const bold = '[1m';
console.log('');
console.log(`${bar}${bold}┌─────────────────────────────────────────────────────────────┐${reset}`);
console.log(`${bar}${bold}│  JobAssist is ready.                                        │${reset}`);
console.log(`${bar}${bold}│                                                             │${reset}`);
console.log(`${bar}${bold}│  Start the dev server:    npm run dev                       │${reset}`);
console.log(`${bar}${bold}│  Open in your browser:    ${reset}${url}${bar}${bold}      │${reset}`);
console.log(`${bar}${bold}│                           (or ${reset}${local}${bar}${bold} works too)        │${reset}`);
console.log(`${bar}${bold}└─────────────────────────────────────────────────────────────┘${reset}`);
console.log('');
