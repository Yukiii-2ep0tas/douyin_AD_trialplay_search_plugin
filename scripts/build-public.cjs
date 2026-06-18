const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'public-dist');
const EXTENSION_DIR = path.join(OUTPUT_ROOT, 'extension');
const ZIP_FILE = path.join(OUTPUT_ROOT, 'douyin-open-helper-public.zip');

const PUBLIC_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'README.md',
  'AGENT.md',
];

const PUBLIC_DIRS = [
  'icons',
];

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileRelative(relativePath) {
  const source = path.join(PROJECT_ROOT, relativePath);
  const target = path.join(EXTENSION_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirRelative(relativePath) {
  const source = path.join(PROJECT_ROOT, relativePath);
  const target = path.join(EXTENSION_DIR, relativePath);
  fs.cpSync(source, target, { recursive: true });
}

function buildZip() {
  fs.rmSync(ZIP_FILE, { force: true });
  execFileSync(
    'zip',
    ['-r', ZIP_FILE, '.'],
    {
      cwd: EXTENSION_DIR,
      stdio: 'inherit',
    }
  );
}

function main() {
  ensureCleanDir(OUTPUT_ROOT);
  fs.mkdirSync(EXTENSION_DIR, { recursive: true });

  PUBLIC_FILES.forEach(copyFileRelative);
  PUBLIC_DIRS.forEach(copyDirRelative);
  buildZip();

  console.log(`public package ready: ${OUTPUT_ROOT}`);
}

main();
