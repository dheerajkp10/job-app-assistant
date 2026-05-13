#!/usr/bin/env node
/* eslint-disable no-console */
// Friendly banner printed after `npm install`. Two URLs work out of
// the box (localhost always; the branded jobassist.com after a
// one-time `npm run setup-domain` writes a /etc/hosts entry).
const ESC = '\x1b';
const bar = `${ESC}[35m`;   // magenta
const dim = `${ESC}[2m`;
const reset = `${ESC}[0m`;
const bold = `${ESC}[1m`;

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - stripAnsi(s).length));
}
const WIDTH = 62;
const line = (txt) => console.log(`${bar}${bold}│${reset}  ${pad(txt, WIDTH)}${bar}${bold}│${reset}`);
const blank = () => console.log(`${bar}${bold}│${reset}${' '.repeat(WIDTH + 2)}${bar}${bold}│${reset}`);

console.log('');
console.log(`${bar}${bold}┌${'─'.repeat(WIDTH + 2)}┐${reset}`);
line(`${bold}JobAssist is ready.${reset}`);
blank();
line(`Start the dev server:`);
line(`  ${bold}npm run dev${reset}`);
blank();
line(`Open in your browser (any of these work):`);
line(`  ${bold}http://localhost:3000${reset}        ${dim}always works, no setup${reset}`);
line(`  ${bold}http://jobassist.com:3000${reset}    ${dim}branded — needs setup${reset}`);
blank();
line(`Enable the branded URL (writes /etc/hosts, asks sudo):`);
line(`  ${bold}npm run setup-domain${reset}                ${dim}# jobassist.com${reset}`);
line(`  ${bold}npm run setup-domain jobassist.test${reset}  ${dim}# safer alt${reset}`);
console.log(`${bar}${bold}└${'─'.repeat(WIDTH + 2)}┘${reset}`);
console.log('');
