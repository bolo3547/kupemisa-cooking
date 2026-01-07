const fs = require('fs');
const path = require('path');

const outDir = __dirname;
const smallPath = path.join(outDir, 'small.jpg');
const largePath = path.join(outDir, 'large.jpg');

// Create small file ~100 KB
fs.writeFileSync(smallPath, Buffer.alloc(100 * 1024, 0xAB));
console.log('Wrote', smallPath, fs.statSync(smallPath).size, 'bytes');

// Create large file ~500 KB
fs.writeFileSync(largePath, Buffer.alloc(500 * 1024, 0xCD));
console.log('Wrote', largePath, fs.statSync(largePath).size, 'bytes');
