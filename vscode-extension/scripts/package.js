// Builds the .vsix. vsce's current release needs Node 20, so the pinned 2.x
// release is used together with a File polyfill for Node 18.
const path = require('path');
const { spawnSync } = require('child_process');

const polyfill = path.join(__dirname, 'file-polyfill.js');
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--require', JSON.stringify(polyfill)]
  .filter(Boolean)
  .join(' ');

const result = spawnSync(
  'npx',
  ['--yes', '@vscode/vsce@2.22.0', 'package', '--no-dependencies', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env }
);

process.exit(result.status == null ? 1 : result.status);
