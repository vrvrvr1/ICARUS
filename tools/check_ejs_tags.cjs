const fs = require('fs');
const path = require('path');
const tplPath = path.resolve(__dirname, '..', 'src', 'views', 'customer', 'homepage.ejs');
const src = fs.readFileSync(tplPath,'utf8');
const uptoLine = 120; // examine first 120 lines
const lines = src.split(/\r?\n/).slice(0,uptoLine);
const prefix = lines.join('\n');
const openMatches = prefix.match(/<%[^%]/g) || [];
const closeMatches = prefix.match(/%>/g) || [];
console.log('lines examined:', lines.length);
console.log('open tags count (<%):', openMatches.length);
console.log('close tags count (%>):', closeMatches.length);
// show last 40 chars before failure
console.log('--- Last 200 chars of examined prefix ---');
console.log(prefix.slice(-200));
// print positions of last few <% and %>
const all = prefix;
let idx = -1; console.log('\nLast 5 <% positions:');
for (let i=0;i<5;i++){
  idx = all.lastIndexOf('<%', idx-1);
  console.log(idx);
}
idx = all.length;
console.log('\nLast 5 %> positions:');
for (let i=0;i<5;i++){
  idx = all.lastIndexOf('%>', idx-1);
  console.log(idx);
}
