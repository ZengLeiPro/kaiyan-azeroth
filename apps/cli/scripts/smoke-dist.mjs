import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const sourceBin = path.resolve(packageRoot, packageJson.bin.azeroth);
assert.ok(fs.existsSync(sourceBin), `package.json bin does not exist: ${sourceBin}`);
if (process.platform !== 'win32') {
  assert.ok((fs.statSync(sourceBin).mode & 0o111) !== 0, 'dist bin is not executable');
}

// Only copy the bin to an empty directory: successful execution proves no workspace runtime
// dependency or pnpm layout is required by the built artifact.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-standalone-'));
const isolatedBin = path.join(tempDir, 'azeroth');
try {
  fs.copyFileSync(sourceBin, isolatedBin);
  if (process.platform !== 'win32') fs.chmodSync(isolatedBin, 0o755);
  for (const args of [['--help'], ['entities'], ['capabilities']]) {
    const result = spawnSync(process.execPath, [isolatedBin, ...args], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}`);
    assert.equal(result.stderr, '', `${args.join(' ')} wrote unexpected stderr`);
    assert.ok(result.stdout.trim().length > 0, `${args.join(' ')} produced no stdout`);
    if (args[0] === 'entities' || args[0] === 'capabilities') {
      assert.ok(Array.isArray(JSON.parse(result.stdout)));
    }
  }

  // doctor scans repository source by design. Execute the copied standalone artifact (not the
  // workspace dist path) with the monorepo as cwd and require a real strict audit exit 0.
  const monorepoRoot = path.resolve(packageRoot, '../..');
  const doctor = spawnSync(process.execPath, [isolatedBin, 'doctor', '--strict'], {
    cwd: monorepoRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(doctor.status, 0, `doctor --strict failed:\n${doctor.stderr}`);
  assert.equal(doctor.stderr, '', 'doctor --strict wrote unexpected stderr');
  const doctorOutput = JSON.parse(doctor.stdout);
  assert.equal(doctorOutput.summary.extras_gap_strong, 0);
  assert.equal(doctorOutput.summary.ghost_extras, 0);
  assert.equal(doctorOutput.summary.decorator_missing, 0);

  console.log(`standalone dist smoke passed (including doctor --strict): ${sourceBin}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
