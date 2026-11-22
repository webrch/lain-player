const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'out', 'LAIN-win32-x64');
const appDir = path.join(out, 'resources', 'app');

fs.rmSync(path.join(root, 'out'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'web'), { recursive: true, force: true });
fs.cpSync(path.join(root, '..', 'player-web'), path.join(root, 'web'), { recursive: true });

fs.mkdirSync(out, { recursive: true });
fs.cpSync(electronDist, out, { recursive: true });
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'LAIN.exe'));

fs.mkdirSync(appDir, { recursive: true });
for (const file of ['main.js', 'preload.js', 'package.json', 'icon.ico']) {
  fs.copyFileSync(path.join(root, file), path.join(appDir, file));
}
fs.cpSync(path.join(root, 'web'), path.join(appDir, 'web'), { recursive: true });

const defaultApp = path.join(out, 'resources', 'default_app.asar');
if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp, { force: true });

console.log('Built portable app: ' + out);
