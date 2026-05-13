#!/usr/bin/env node
/* eslint-disable no-console */
// Dev-server launcher with cert auto-detection.
//
// When ./certs/cert.pem + ./certs/key.pem exist (produced by
// `npm run setup-domain`), we boot Next.js in HTTPS mode using
// Next's built-in --experimental-https flag. This is REQUIRED for
// the branded .dev URL — every .dev domain is on the HSTS preload
// list, so browsers force https://. Without certs we fall back to
// plain HTTP on port 3000.
//
// Either way, the server binds to 0.0.0.0 so any hostname that
// resolves to 127.0.0.1 (job-assist.dev, localhost, …) routes here.
const { existsSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const certPath = path.join(process.cwd(), 'certs', 'cert.pem');
const keyPath = path.join(process.cwd(), 'certs', 'key.pem');
const hasCerts = existsSync(certPath) && existsSync(keyPath);

const args = ['next', 'dev', '-H', '0.0.0.0'];
if (hasCerts) {
  args.push(
    '--experimental-https',
    '--experimental-https-cert', certPath,
    '--experimental-https-key', keyPath,
  );
  // eslint-disable-next-line no-console
  console.log('\x1b[32mUsing TLS certs from ./certs — server will boot in HTTPS mode.\x1b[0m');
} else {
  console.log('\x1b[2mNo ./certs/cert.pem found — booting in plain HTTP mode.\x1b[0m');
  console.log('\x1b[2mRun `npm run setup-domain` to enable HTTPS + the branded URL.\x1b[0m');
}

const child = spawn('npx', args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
