// Copies Inkwell's own Markdown bundle and stylesheets into media/, so the
// preview in VS Code renders exactly like the app instead of drifting from it.
const fs = require('fs');
const path = require('path');

const renderer = path.join(__dirname, '..', '..', 'src', 'renderer');
const webview = path.join(__dirname, '..', 'webview');
const media = path.join(__dirname, '..', 'media');

const files = ['markdown-bundle.js', 'style.css', 'hljs.css', 'katex.css'];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const kb = Math.round(fs.statSync(to).size / 1024);
  console.log(`  ${path.relative(media, to)} (${kb} kB)`);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dest);
    else { fs.copyFileSync(src, dest); count += 1; }
  }
  return count;
}

fs.mkdirSync(media, { recursive: true });
console.log('Copying Inkwell renderer assets into media/');
for (const file of files) {
  const src = path.join(renderer, file);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${src} — run this from the Inkwell repository.`);
    process.exit(1);
  }
  copyFile(src, path.join(media, file));
}

const fonts = copyDir(path.join(renderer, 'fonts'), path.join(media, 'fonts'));
console.log(`  fonts/ (${fonts} files)`);

// The extension's own webview code lives in webview/ and is copied in last, so
// media/ stays a generated folder.
console.log('Copying the webview code');
for (const entry of fs.readdirSync(webview, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  copyFile(path.join(webview, entry.name), path.join(media, entry.name));
}
console.log('Done.');
