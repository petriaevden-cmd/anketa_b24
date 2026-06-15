const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require("playwright");
require("child_process").execSync("node "+path.join(__dirname,"make-harness.js"),{stdio:"inherit"});
const ROOT=path.join(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript'};
function serve(){return new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/harness.test.html';const fp=path.join(ROOT,p);if(!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(res);});s.listen(0,()=>r(s));});}
(async()=>{
const srv=await serve();const port=srv.address().port;
const b=await chromium.launch({executablePath:'/home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell'});
// Narrow tall viewport closer to a Bitrix lead-card iframe
const pg=await b.newPage({viewport:{width:1280,height:600}});
await pg.goto(`http://127.0.0.1:${port}/harness.test.html?leadId=12826`,{waitUntil:'networkidle'});
await pg.waitForFunction(()=>{const f=document.getElementById('anketa-form');return f&&!f.classList.contains('hidden')&&document.querySelector('#section-9-body input[type=radio]');},{timeout:8000}).catch(()=>{});
// Scroll to absolute bottom, then click a HIGH radio that changes status -> verdict-reasons grows above viewport
await pg.evaluate(()=>{const f=document.getElementById("anketa-form");const w=f.parentElement;w.scrollTop=w.scrollHeight;});
await pg.waitForTimeout(80);
const before=await pg.evaluate(()=>document.getElementById("anketa-form").parentElement.scrollTop);
// forOther=Y is a stop-factor high in the form (section 9) -> changes verdict reasons
await pg.evaluate(()=>{document.querySelector('input[name="forOther"][value="Y"]').closest('label').querySelector('span').click();});
await pg.waitForTimeout(150);
const after=await pg.evaluate(()=>document.getElementById("anketa-form").parentElement.scrollTop);const winAfter=await pg.evaluate(()=>Math.round(window.scrollY||0));
console.log("bottom + stop-factor click: dScroller="+Math.round(after-before)+" dWindow="+winAfter);
// Toggle more stop factors while at the bottom; assert WINDOW never moves
// (the scroller may legitimately clamp scrollTop when content height shrinks).
let maxWin=Math.abs(winAfter);
for(const n of ['otherCompanyAS','incomeKmBad','nonDischargeable']){
  await pg.evaluate(()=>window.scrollTo(0,0));
  await pg.evaluate((nm)=>{const el=document.querySelector(`input[name="${nm}"][value="Y"]`);if(el)el.closest('label').querySelector('span').click();},n);
  await pg.waitForTimeout(120);
  const w=await pg.evaluate(()=>Math.round(window.scrollY||0));
  maxWin=Math.max(maxWin,Math.abs(w));
  console.log(`${n}=Y at bottom: dWindow=${w}`);
}
console.log('\nMAX |dWindow| = '+maxWin+' px  RESULT: '+(maxWin<=4?'PASS':'FAIL'));
await b.close();srv.close();
process.exit(maxWin<=4?0:1);
})();
