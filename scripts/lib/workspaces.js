const fs = require('node:fs');
const path = require('node:path');

function workspacePatterns(root) {
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) return ['apps/*', 'packages/*'];

  return fs
    .readFileSync(workspaceFile, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function expandSingleStar(root, pattern) {
  const segments = pattern.split('/');
  if (segments.filter((segment) => segment === '*').length !== 1) {
    throw new Error(`不支持的 workspace pattern（仅支持单个 *）：${pattern}`);
  }

  const starIndex = segments.indexOf('*');
  const parent = path.join(root, ...segments.slice(0, starIndex));
  const suffix = segments.slice(starIndex + 1);
  if (!fs.existsSync(parent)) return [];

  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name, ...suffix))
    .filter((directory) => fs.existsSync(path.join(directory, 'package.json')));
}

function discoverWorkspacePackages(root) {
  const directories = workspacePatterns(root).flatMap((pattern) => expandSingleStar(root, pattern));
  return [...new Set(directories)]
    .map((directory) => {
      const packageJsonPath = path.join(directory, 'package.json');
      return {
        directory,
        relativeDirectory: path.relative(root, directory).split(path.sep).join('/'),
        packageJsonPath,
        packageJson: JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')),
      };
    })
    .sort((left, right) => left.relativeDirectory.localeCompare(right.relativeDirectory));
}

function productionSourceDirs(root) {
  return discoverWorkspacePackages(root)
    .map((workspace) => path.join(workspace.directory, 'src'))
    .filter((directory) => fs.existsSync(directory));
}

module.exports = { discoverWorkspacePackages, productionSourceDirs };
