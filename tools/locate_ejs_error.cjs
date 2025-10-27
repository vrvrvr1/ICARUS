const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const tplPath = path.resolve(__dirname, '..', 'src', 'views', 'customer', 'homepage.ejs');
const src = fs.readFileSync(tplPath,'utf8');
const lines = src.split(/\r?\n/);
for (let i=1;i<=lines.length;i++){
  const snippet = lines.slice(0,i).join('\n');
  try {
    ejs.compile(snippet, {filename: tplPath});
  } catch (err) {
    console.error('Compile failed at line:', i);
    console.error(err && err.message ? err.message : err);
    // print surrounding lines
    const start = Math.max(0,i-5);
    const end = Math.min(lines.length, i+5);
    console.error('Context:');
    for (let j=start;j<end;j++){
      const mark = (j+1===i)? '>>' : '  ';
      console.error(mark, (j+1)+':', lines[j]);
    }
    process.exit(2);
  }
}
console.log('No error detected when compiling incremental prefixes.');
