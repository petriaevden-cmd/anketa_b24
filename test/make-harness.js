// Builds harness.test.html from index.php by stripping the PHP and replacing
// the BX24 webhook bootstrap with an offline stub that returns a mock lead.
// This lets the real assets/*.js render the form without PHP or a Bitrix24
// portal, so the click-jump regression can be checked headlessly.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let s = fs.readFileSync(path.join(ROOT, 'index.php'), 'utf8');
s = s.slice(s.indexOf('<!DOCTYPE'));

const STUB = `<script>
window.APP_CONFIG={salesDeptId:1,bpTemplateId:40,appEnv:"dev",slotMin:60,horizonDays:7,minSlots:1,clientHrMin:9,clientHrMax:20,minMpPerDay:3,webhookUrl:"",currentUser:{ID:0,NAME:"",LAST_NAME:"",EMAIL:""},logUrl:""};
window.APP_USE_WEBHOOK=false;
var MOCK_LEAD={ID:12826,TITLE:"Тестовый лид #12826",CONTACT_ID:"0"};
var MOCK_USER={ID:1,NAME:"Тест",LAST_NAME:"Менеджер",SECOND_NAME:""};
function wrap(d,e){return{data:function(){return d;},error:function(){return e||false;},total:function(){return 0;}};}
window.BX24={init:function(cb){setTimeout(cb,0);},placement:{info:function(){return{placement:"CRM_LEAD_DETAIL_TAB",options:{ID:12826}};}},callMethod:function(m,p,cb){var d={};if(m==="crm.lead.get")d=MOCK_LEAD;else if(m==="user.current")d=MOCK_USER;else if(m==="user.get")d=[MOCK_USER];else if(m==="department.get")d=[];setTimeout(function(){cb&&cb(wrap(d));},0);return true;},callBatch:function(c,cb){var o={};Object.keys(c).forEach(function(k){var m=c[k][0];if(m==="crm.lead.get")o[k]=wrap(MOCK_LEAD);else if(m==="user.current")o[k]=wrap(MOCK_USER);else o[k]=wrap([]);});setTimeout(function(){cb&&cb(o);},0);return true;},callBind:function(){return true;},callUnbind:function(){return true;},installFinish:function(){},getAuth:function(){return null;}};
</script>`;

// Strip the PHP-generated APP_CONFIG block, the mode-selection script (iframe
// detection + SDK injection), and the webhook-client include; inject the stub.
s = s.replace(/<script>\s*\n\s*window\.APP_CONFIG[\s\S]*?<\/script>/, '');
// Mode-selection <script> sets window.APP_USE_WEBHOOK and (in iframe) document.writes
// the BX24 SDK. Remove the whole block — the stub provides BX24 + APP_USE_WEBHOOK=false.
s = s.replace(/<script>\s*\n\s*\/\/ Вне iframe[\s\S]*?<\/script>/, '');
s = s.replace(/<\?php[\s\S]*?\?>/g, '');
s = s.replace(/<script src="assets\/webhook-client\.js"><\/script>/, '');
s = s.replace(/<script src="assets\/tz-utils\.js"><\/script>/, STUB + '\n<script src="assets/tz-utils.js"></script>');
s = s.replace(/<script type="text\/javascript">\s*\(function\(m,e,t,r,i,k,a\)[\s\S]*?<\/noscript>/, '<!-- metrika removed for test -->');

fs.writeFileSync(path.join(ROOT, 'harness.test.html'), s, 'utf8');
console.log('Wrote harness.test.html (' + s.length + ' bytes)');
