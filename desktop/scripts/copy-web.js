const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', '..', 'player-web');
const target = path.join(__dirname, '..', 'web');

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log('Copied player-web -> desktop/web');
