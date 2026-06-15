// Screenshots: panel proportions at 1440 & 1280, plus the restyled booking-body card.
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
require('child_process').execSync('node '+path.join(__dirname,'make-harness.js'),{stdio:'inherit'});
const ROOT=path.join(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript'};
function serve(){return new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/harness.test.html';const fp=path.join(ROOT,p);if(!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(res);});s.listen(0,()=>r(s));});}
(async()=>{
  const srv=await serve();const port=srv.address().port;
  const b=await chromium.launch({executablePath:'/home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell'});
  for(const w of [1440,1280]){
    const pg=await b.newPage({viewport:{width:w,height:820}});
    await pg.goto(`http://127.0.0.1:${port}/harness.test.html?leadId=12826`,{waitUntil:'networkidle'});
    await pg.waitForFunction(()=>{const f=document.getElementById('anketa-form');return f&&!f.classList.contains('hidden');},{timeout:8000}).catch(()=>{});
    // Measure the two panel widths.
    const dims=await pg.evaluate(()=>{
      const row=document.querySelector('#app > div.flex.flex-1');
      const left=row.children[0], right=row.children[1];
      return {total:row.clientWidth,left:left.clientWidth,right:right.clientWidth,
              leftPct:Math.round(left.clientWidth/row.clientWidth*100),
              rightPct:Math.round(right.clientWidth/row.clientWidth*100)};
    });
    console.log(`@${w}px  left=${dims.left}px (${dims.leftPct}%)  right=${dims.right}px (${dims.rightPct}%)`);
    // Force-render the booking-body card to screenshot the new styling.
    await pg.evaluate(()=>{
      const bb=document.getElementById('booking-body');
      // Minimal stub mirroring booking.js selectSlot card markup with real channel opts.
      const opts=[['4280','WhatsApp'],['4281','Telegram'],['4340','Max (мессенджер)'],['5424','SMS'],['5442','Не отправлять']]
        .map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('');
      bb.innerHTML='<div class="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3">'+
        '<div class="flex items-center gap-2 text-sm font-semibold text-gray-900"><span class="w-5 h-5 rounded bg-blue-50 flex items-center justify-center text-blue-500"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></span>Подтверждение записи</div>'+
        '<div class="space-y-1"><div class="flex justify-between text-xs"><span class="text-gray-500">МП</span><span class="font-medium text-gray-800">МП5 Самара</span></div>'+
        '<div class="flex justify-between text-xs"><span class="text-gray-500">Время МП</span><span class="font-mono font-medium text-gray-800">14:00 UTC+4</span></div>'+
        '<div class="flex justify-between text-xs"><span class="text-gray-500">Время клиента</span><span class="font-mono font-medium text-blue-600">13:00 UTC+3</span></div></div>'+
        '<div class="flex flex-col gap-1"><label class="block text-sm font-medium text-gray-700">Канал консультации</label>'+
        `<select class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2">${opts}</select></div>`+
        '<button type="button" class="w-full justify-center inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>Подтвердить запись</button></div>';
      const f=document.getElementById('anketa-form');const wr=f.parentElement;wr.scrollTop=wr.scrollHeight;
    });
    await pg.waitForTimeout(150);
    await pg.screenshot({path:path.join(ROOT,`test/shot_${w}.png`),fullPage:false});
    console.log(`  saved test/shot_${w}.png`);
    await pg.close();
  }
  await b.close();srv.close();
})();
