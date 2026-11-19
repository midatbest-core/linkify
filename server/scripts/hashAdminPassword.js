import { randomBytes, scryptSync } from 'node:crypto';
import process from 'node:process';

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  console.error('Run this command in a terminal so the password can be entered without echo.');
  process.exit(1);
}

process.stdout.write('Admin password (hidden): ');
process.stdin.setRawMode(true);
process.stdin.resume();
let password = '';
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString('utf8')) {
    if (character === '\u0003') { process.stdout.write('\nCancelled.\n'); process.exit(1); }
    if (character === '\r' || character === '\n') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (password.length < 12) { process.stdout.write('\nUse at least 12 characters.\n'); process.exit(1); }
      const salt = randomBytes(16);
      const digest = scryptSync(password, salt, 64);
      password = '';
      process.stdout.write(`\nADMIN_PASSWORD_HASH=scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}\n`);
      return;
    }
    if (character === '\u007f' || character === '\b') password = Array.from(password).slice(0, -1).join('');
    else if (character >= ' ') password += character;
  }
});
