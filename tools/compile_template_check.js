const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const tplPath = path.resolve(__dirname, '..', 'src', 'views', 'customer', 'homepage.ejs');
try {
  const src = fs.readFileSync(tplPath, 'utf8');
  // Attempt to compile template (no rendering) to surface syntax errors
  ejs.compile(src, {filename: tplPath});
  console.log('EJS compile: OK');
} catch (err) {
  console.error('EJS compile: FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 2;
}
