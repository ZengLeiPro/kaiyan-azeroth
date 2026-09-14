import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'dist', 'index.js');
const source = fs.readFileSync(binPath, 'utf8');
if (!source.startsWith('#!/usr/bin/env node\n')) {
  throw new Error(`CLI bundle is missing a single leading node shebang: ${binPath}`);
}
if (process.platform !== 'win32') fs.chmodSync(binPath, 0o755);
