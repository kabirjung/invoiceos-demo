const $=(q,r=document)=>r.querySelector(q);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash=n=>{const v=Number(n||0),whole=Math.abs(v-Math.round(v))<0.005;return '₹'+v.toLocaleString('en-IN',{minimumFractionDigits:whole?0:2,maximumFractionDigits:2})};
const dateFmt=s=>{if(!s)return'—';const d=new Date(s);return isNaN(d)?s:d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
const profiles={
  owner:{label:'Arjun Kulkarni · Owner · Northstar Studio',org:'northstar',side:'supplier',readOnly:false,create:true,approve:true,pay:true},
  finance_manager:{label:'Meera Nair · Finance Manager · Northstar Studio',org:'northstar',side:'supplier',readOnly:false,create:true,approve:true,pay:true},
  ar:{label:'Priya Shah · AR Accountant · Northstar Studio',org:'northstar',side:'supplier',readOnly:false,create:true,approve:false,pay:true},
  ap:{label:'Riya Menon · AP Accountant · Meridian Retail',org:'meridian',side:'buyer',readOnly:false,create:false,approve:false,pay:false},
  approver:{label:'Kavita Rao · Approver · Meridian Retail',org:'meridian',side:'buyer',readOnly:false,create:false,approve:true,pay:false},
  buyer_portal:{label:'Buyer contact · Portal',org:'meridian',side:'buyer',readOnly:false,external:true,create:false,approve:true,pay:true},
  vendor_portal:{label:'Vendor contact · Portal',org:'northstar',side:'supplier',readOnly:true,external:true,create:false,approve:false,pay:false},
  auditor:{label:'Ananya Iyer · Auditor / CA · Read only',org:'northstar',side:'supplier',readOnly:true,create:false,approve:false,pay:false}
};
const store={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(_){}}};
const themeMedia=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
function storedTheme(){const v=store.get('invoiceos_theme');return v==='dark'||v==='light'?v:null}
function currentTheme(){const attr=document.documentElement.getAttribute('data-theme');if(attr==='dark'||attr==='light')return attr;const saved=storedTheme();if(saved)return saved;return themeMedia&&themeMedia.matches?'dark':'light'}
function syncThemeControls(){const dark=currentTheme()==='dark';document.querySelectorAll('[data-theme-toggle]').forEach(b=>{b.setAttribute('aria-pressed',String(dark));const label=dark?'Switch to light theme':'Switch to dark theme';b.setAttribute('aria-label',label);b.setAttribute('title',label)})}
function setTheme(theme,persist=false){const dark=theme==='dark';document.documentElement.setAttribute('data-theme',dark?'dark':'light');document.documentElement.style.colorScheme=dark?'dark':'light';const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',dark?'#0d1117':'#f7f8fa');if(persist)store.set('invoiceos_theme',dark?'dark':'light');syncThemeControls()}
setTheme(currentTheme());
if(themeMedia&&themeMedia.addEventListener)themeMedia.addEventListener('change',e=>{if(!storedTheme())setTheme(e.matches?'dark':'light')});
let role=store.get('invoiceos_role')||'owner';if(!profiles[role])role='owner';
const demoRoute=/^\/demo\/?$/.test(location.pathname);
const demoParams=new URLSearchParams(location.search);
const demoPick=demoRoute&&demoParams.has('pick');
const requestedRole=demoRoute?(demoParams.get('role')||''):'';
if(requestedRole&&profiles[requestedRole]){role=requestedRole;store.set('invoiceos_role',role)}
const demoPageParam=demoRoute?(demoParams.get('page')||''):'';
const demoRecordId=demoRoute?(demoParams.get('id')||''):'';
const demoStartPages=new Set(['overview','invoices','bills','approvals','disputes','connections','payments','team','activity','insights','more','builder','billUpload','portal','calendar','cashflow','collections','paymentRun','auditPack']);
let page=demoPick?'roles':demoRoute?'boot':'landing',selectedId=demoRecordId,state={businesses:[],invoices:[],comments:[],activity:[],bill_activity:[],bills:[],connections:[],calendar_events:[],staff:[]},toastTimer;
const me=()=>profiles[role], company=id=>state.businesses.find(b=>b.id===id)||{id,name:id||'Business',gstin:'',city:''};
function portalLabel(){return me().side==='buyer'?'Buyer portal':'Supplier portal'}
function setApiStatus(next,label){const el=$('#apiStatus');if(!el)return;el.dataset.state=next;el.title=label;const text=el.querySelector('span');if(text)text.textContent=label;if(next==='live')hideNetBanner()}
let pendingRequests=0,progressTimer=null;
function apiBusy(on){
 const bar=$('#apiProgress');if(!bar)return;
 pendingRequests=Math.max(0,pendingRequests+(on?1:-1));
 clearTimeout(progressTimer);
 if(pendingRequests){bar.hidden=false;requestAnimationFrame(()=>{if(pendingRequests)bar.classList.add('show')})}
 else{bar.classList.remove('show');progressTimer=setTimeout(()=>{if(!pendingRequests)bar.hidden=true},200)}
}
const isLocalHost=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const HOSTED_MSG='The demo data service is not connected on this site yet. Please try again later.';
function showNetBanner(message){const el=$('#netBanner');if(!el)return;const msg=$('#netBannerMsg');if(msg&&message)msg.textContent=isLocalHost?message:HOSTED_MSG;const ttl=el.querySelector('b');if(ttl)ttl.textContent=isLocalHost?'Demo API offline':'Demo data unavailable';el.classList.add('show')}
function hideNetBanner(){const el=$('#netBanner');if(el)el.classList.remove('show')}
async function retryConnection(){
 const btn=$('#netRetry');if(btn){btn.disabled=true;btn.textContent='Retrying…'}
 try{await refresh();hideNetBanner();toast('Demo API reconnected','success')}
 catch(err){showNetBanner('Still offline. Start server.py in the outputs folder, then retry.')}
 finally{if(btn){btn.disabled=false;btn.textContent='Retry'}}
}
async function api(path,opts={}){
 let r;const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
 apiBusy(true);
 try{r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})},signal:ctl.signal})}
 catch(error){
   setApiStatus('offline','Demo API offline');
   const timedOut=error&&error.name==='AbortError';
   showNetBanner(timedOut?'The demo API timed out. It may be restarting.':'The demo API is unreachable. Start server.py and retry.');
   throw new Error(timedOut?'The demo API timed out. Try again in a moment.':'The local demo server could not be reached. Restart it and try again.');
 }finally{clearTimeout(timer);apiBusy(false)}
 setApiStatus('live','Demo API connected');
 let d;try{d=await r.json()}catch(error){setApiStatus('error','Demo API unavailable');showNetBanner('The demo data service is not available on this deployment (the API returned a non-JSON response).');throw new Error('The demo data service is not available here. This site needs its data service to load records.')}
 if(!r.ok)throw new Error(d.error||'Something went wrong');
 return d;
}
async function refresh(){
 const view=$('#view');
 if(view&&!['landing','roles'].includes(page))view.setAttribute('aria-busy','true');
 try{state=await api('/api/bootstrap');if(page==='boot'){if(!me().external&&demoRecordId&&state.invoices.some(i=>i.id===demoRecordId))page='detail';else page=me().external?'portal':(demoStartPages.has(demoPageParam)?demoPageParam:'overview')}updateWorkspace();bizInvalidate();render()}
 finally{if(view)view.removeAttribute('aria-busy')}
}
function moneyFor(i){return cash(i.total)}
function toast(msg,tone='info'){const t=$('#toast');if(!t)return;t.textContent=msg;t.dataset.tone=tone;t.setAttribute('aria-live',tone==='error'?'assertive':'polite');t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),tone==='error'?4200:2800)}
$('#netRetry')?.addEventListener('click',retryConnection);
$('#netDismiss')?.addEventListener('click',hideNetBanner);
window.addEventListener('online',()=>{if($('#netBanner')?.classList.contains('show'))retryConnection()});
function updateWorkspace(){const b=company(me().org);$('#orgName').textContent=b.name;$('#orgAvatar').textContent=b.name[0];$('.workspace small').textContent='GSTIN · '+(b.gstin||'Demo profile');$('#role').value=role;const who=calMeStaff();const pr=$('.sidebar .profile');if(pr&&who){const av=pr.querySelector('.avatar'),nm=pr.querySelector('b'),sm=pr.querySelector('small');if(av)av.textContent=who.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();if(nm)nm.textContent=who.name;if(sm)sm.textContent=who.title}}
function changeRole(next){if(!profiles[next])return;role=next;store.set('invoiceos_role',role);invoiceFilters={q:'',status:''};if(demoRoute){try{history.replaceState(null,'','/demo')}catch(_){}}updateWorkspace();page=me().external?'portal':'overview';render()}
function hasScope(connection,scope){try{return JSON.parse(connection.scopes||'[]').includes(scope)}catch{return false}}
function isConnected(a,b,scope='exchange_invoices'){return state.connections.some(c=>c.status==='Connected'&&hasScope(c,scope)&&((c.requester===a&&c.target===b)||(c.requester===b&&c.target===a)))}
function invoicesForRole(){return state.invoices.filter(i=>{if(!isConnected(i.supplier,i.customer))return false;if(me().side==='supplier')return i.supplier===me().org&&!(me().external&&i.status==='Draft');return i.customer===me().org&&i.status!=='Draft'})}
function billsForRole(){return state.bills.filter(b=>me().side==='buyer'?b.buyer===me().org:b.vendor===me().org)}

function queueCounts(){
  const inv=invoicesForRole(),bills=billsForRole();
  const invoicePending=inv.filter(i=>i.status==='Pending approval');
  const billPending=bills.filter(b=>b.status==='Needs approval');
  const openInv=inv.filter(i=>!['Draft','Paid','Rejected','Resolved'].includes(i.status));
  const openBills=bills.filter(b=>!['Paid','Rejected'].includes(b.status));
  const activeRecords=roleVisibleRecords().filter(r=>!['Draft','Paid','Rejected','Resolved'].includes(r.status));
  return {
    invoices:inv.length,
    bills:bills.length,
    approvals:invoicePending.length+(me().side==='buyer'?billPending.length:0),
    invoicePending,billPending,
    disputes:inv.filter(i=>i.status==='Dispute').length,
    openInv,openBills,
    team:activeRecords.length,
    activity:visibleActivity().length,
    calendar:calOpenCount()
  };
}
function roleHiddenPages(){const h=roleHiddenBase();for(const k of bizHiddenPages())h.add(k);return h}
function roleHiddenBase(){
  if(role==='buyer_portal'||role==='vendor_portal')return new Set(['overview','invoices','bills','approvals','disputes','connections','payments','team','activity','insights','calendar']);
  if(role==='ar')return new Set(['bills','approvals']);
  if(role==='approver')return new Set(['connections','payments']);
  return new Set();
}
function ageLabel(i){
  if(i.status==='Paid')return {label:'Settled',cls:'settled'};
  if(i.status==='Draft')return {label:'Not sent',cls:''};
  if(i.status==='Overdue')return {label:'Marked overdue',cls:'late'};
  const d=dueOffset(i.due_date);
  if(d===null)return {label:'No due date',cls:''};
  if(d<0)return {label:`${Math.abs(d)}d overdue`,cls:'late'};
  if(d===0)return {label:'Due today',cls:'soon'};
  if(d<=7)return {label:`${d}d left`,cls:'soon'};
  return {label:`${d}d left`,cls:''};
}
function sortTh(label,key,cls=''){return `<th class="${cls}"><button type="button" class="sort-btn" data-sort="${key}">${label}<span class="sort-caret" aria-hidden="true">↕</span></button></th>`}
let invoiceSort={key:'issue_date',dir:-1};
let invoiceFilters={q:'',status:''};
function invoiceFiltered(){
  const q=invoiceFilters.q.toLowerCase(),st=invoiceFilters.status;
  return invoicesForRole().filter(i=>(!st||i.status===st)&&(`${i.id} ${company(me().side==='supplier'?i.customer:i.supplier).name}`).toLowerCase().includes(q));
}
function invoiceSorted(list){
  const k=invoiceSort.key,dir=invoiceSort.dir;
  return [...list].sort((a,b)=>{
    if(k==='business'){const x=company(me().side==='supplier'?a.customer:a.supplier).name,y=company(me().side==='supplier'?b.customer:b.supplier).name;return String(x).localeCompare(String(y))*dir}
    if(k==='total')return (Number(a.total||0)-Number(b.total||0))*dir;
    return String(a[k]||'').localeCompare(String(b[k]||''))*dir;
  });
}
function invoiceTotals(list){
  const total=list.reduce((n,i)=>n+Number(i.total||0),0);
  const open=list.filter(i=>!['Paid','Rejected','Resolved','Draft'].includes(i.status));
  return {total,openTotal:open.reduce((n,i)=>n+Number(i.total||0),0)};
}
function renderInvoiceTable(){
  const body=$('#invoiceRows');if(!body)return;
  const list=invoiceSorted(invoiceFiltered());
  body.innerHTML=invoiceRows(list,true,true);
  const t=invoiceTotals(list),foot=$('#invoiceTotals');
  if(foot)foot.innerHTML=`<span><b>${list.length}</b> invoice${list.length===1?'':'s'} in view</span><span>Open value <b>${cash(t.openTotal)}</b></span><span>Total <b>${cash(t.total)}</b></span>`;
  document.querySelectorAll('[data-quick-status]').forEach(b=>b.classList.toggle('active',b.dataset.quickStatus===invoiceFilters.status));
  document.querySelectorAll('#invoiceTable [data-sort]').forEach(th=>{
    const active=th.dataset.sort===invoiceSort.key;
    th.classList.toggle('sorted',active);
    th.dataset.dir=active?String(invoiceSort.dir):'';
    th.closest('th').setAttribute('aria-sort',active?(invoiceSort.dir===1?'ascending':'descending'):'none');
  });
}
function btn(label,action,kind=''){return `<button class="btn ${kind}" data-action="${esc(action)}">${label}</button>`}
function head(kicker,title,desc,action=''){return `<div class="heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div><div class="actions">${action}</div></div>`}
function panelTitle(title,link=''){return `<div class="panel-head"><h2>${title}</h2>${link}</div>`}
function metric(label,value,foot,icon='↗',warn=false){return `<div class="card metric"><div class="metric-top"><span>${label}</span><span>${icon}</span></div><div class="value">${value}</div><div class="trend ${warn?'warn':''}">${foot}</div></div>`}
function badge(s){const kind=({'Paid':'paid','Approved':'approved','Pending approval':'pending','Needs approval':'pending','Sent':'sent','Viewed':'sent','Overdue':'overdue','Dispute':'dispute','Resolved':'approved','Rejected':'overdue','Draft':'review','Partially paid':'pending','Received':'sent','Scheduled':'sent'})[s]||'pending';return `<span class="status s-${kind}">${esc(s)}</span>`}
function landingSummary(){const inv=state.invoices.filter(i=>i.supplier==='northstar'&&!['Draft','Paid','Rejected','Resolved'].includes(i.status));const bills=state.bills.filter(b=>b.buyer==='meridian'&&!['Paid','Rejected'].includes(b.status));const action=state.invoices.filter(i=>i.supplier==='northstar'&&['Pending approval','Dispute','Overdue'].includes(i.status)).length+state.bills.filter(b=>b.buyer==='meridian'&&['Received','Needs approval'].includes(b.status)).length;const value=inv.reduce((n,i)=>n+Number(i.total||0),0);const partners=state.connections.filter(c=>c.status==='Connected'&&(c.requester==='northstar'||c.target==='northstar')).length;return{inv,bills,action,value,partners}}
/* ==== LANDING v3 · page (data + markup). Numbers are read from the sample records in `state`; everything else describes the product, with honest tags. ==== */
const L3_TAG={live:'Live in demo',sim:'Simulated',planned:'Planned',human:'Human decides'};
const l3Tag=(kind,label)=>`<span class="l3-tag l3-tag-${esc(kind)}">${esc(label||L3_TAG[kind]||kind)}</span>`;
const l3Threads=[
 {key:'sheet',paper:'The invoice spreadsheet',icon:'▦',tile:'Invoices',color:'#00c853',pain:'Receivables live in a spreadsheet.',problem:'Each invoice is copied into a sheet by hand, and the sheet is out of date by lunch.',fix:'Every invoice is a record with its buyer, its status and its history. The list is a view of the records, not a copy of them.',tags:[['live']]},
 {key:'chase',paper:'The WhatsApp payment chase',icon:'✆',tile:'Collections',color:'#ff6b35',pain:'Payments are chased one chat at a time.',problem:'A reminder goes out from someone’s phone, and nobody else can see what was promised.',fix:'Overdue invoices gather in one queue. A reminder is drafted on the invoice, and a person decides whether it goes.',tags:[['live','Overdue queue'],['sim','Reminder drafts']]},
 {key:'approval',paper:'The approval email chain',icon:'✉',tile:'Approvals',color:'#7b61ff',pain:'The yes is three replies down.',problem:'The bill is in one email, the PO in another, and the approval arrives in a forward.',fix:'Bills and invoices go to an approver with the record in view. The decision stays attached to it.',tags:[['live'],['human']]},
 {key:'gst',paper:'The GST reconciliation scramble',icon:'%',tile:'GST',color:'#00b8d9',pain:'GST is checked at the deadline.',problem:'GSTINs, rates and totals are matched by hand in the week the return is due.',fix:'GSTINs and the GST split sit on each invoice from the day it is raised. Return filing and portal matching are planned.',tags:[['live','GST on invoices'],['planned','Return filing']]},
 {key:'pile',paper:'The vendor bill pile',icon:'▤',tile:'Bills inbox',color:'#ff2d95',pain:'Vendor bills arrive in a pile.',problem:'PDFs in email, paper on a desk, and every bill typed in again before anyone reviews it.',fix:'Bills land in one AP inbox, from a connected vendor or an upload, and wait for review beside their PO.',tags:[['live','AP inbox'],['sim','Field extraction']]},
 {key:'close',paper:'The month-end close',icon:'◷',tile:'Calendar',color:'#2979ff',pain:'Month-end is a week of hunting.',problem:'Open invoices, unapproved bills and unanswered queries turn up on the last day.',fix:'The queues show what is still open, and each loose end becomes a task with an owner and a date on the team calendar.',tags:[['live','Queues + calendar'],['planned','Close checklist']]},
 {key:'memory',paper:'The owner’s memory',icon:'◉',tile:'Owner view',color:'#ffb800',pain:'The business runs on who remembers what.',problem:'Who owes what, who is chasing it and when it is due lives in one person’s head.',fix:'One view of receivables, payables, approvals and team deadlines, with flags on what needs a decision.',tags:[['live']]}
];
const l3Cases=[
 {id:'overdue',tab:'Overdue invoice',color:'#ff6b35',q:'What happens when an invoice goes overdue?',big:'Overdue',module:'Receivables',role:'ar',page:'invoices',
  steps:[['AR','#00c853','Flagged on the due date','The invoice moves into the overdue queue once its due date passes. Nobody has to spot it in a sheet.',''],['AR','#00c853','A reminder is drafted','A reminder is prepared on the invoice with the amount and the due date filled in.','sim'],['AR','#00c853','A person sends it, or not','The AR accountant edits the draft and decides. Nothing leaves this demo.','human'],['Finance manager','#7b61ff','The chase gets an owner','The follow-up sits on the team calendar with an assignee and a completion date.',''],['Buyer','#ff2d95','The buyer sees the same invoice','The buyer’s portal shows the invoice and its status, so the reply lands on the record.','']],
  result:'One overdue invoice: one queue, one owner, one shared record.'},
 {id:'dispute',tab:'Disputed invoice',color:'#ff2d95',q:'What happens when a buyer questions an invoice?',big:'Disputed',module:'Disputes',role:'ar',page:'disputes',
  steps:[['Buyer','#ff2d95','A query is raised on the invoice','The buyer marks the invoice disputed and gives a reason on the shared record.',''],['AR','#00c853','The supplier sees it at once','The dispute shows in the supplier’s queue with the reason attached.',''],['AR','#00c853','Replies stay on the record','Both sides reply in context. The amount, the reason and the answers stay together.','sim'],['Approver','#7b61ff','A person settles it','Someone with the authority resolves it or asks for a corrected invoice.','human'],['Auditor','#2979ff','The trail is readable later','The activity trail keeps who did what, and when.','']],
  result:'One question, answered on the invoice it is about.'},
 {id:'vendor',tab:'New vendor',color:'#00b8d9',q:'What happens when you start buying from a new vendor?',big:'New vendor',module:'Connections',role:'owner',page:'connections',
  steps:[['Owner','#ffb800','Connect the business','Add the vendor with its GSTIN and city and send a connection request.',''],['Vendor','#ff2d95','Both sides choose what to share','Each business switches on the scopes it shares: invoices, payment status, or both.',''],['AP','#00b8d9','Their invoices arrive as bills','A connected vendor’s invoice lands in the AP inbox already filled in.',''],['Approver','#7b61ff','The first bill is reviewed','An approver checks it against the PO before it moves on.','human'],['Finance manager','#2979ff','The vendor gets a scorecard','On-time bills, disputes and corrections per vendor.','planned']],
  result:'One connection, and every later invoice arrives on the record.'},
 {id:'close',tab:'Month-end close',color:'#2979ff',q:'What happens in the last week of the month?',big:'Month-end',module:'Close',role:'finance_manager',page:'calendar',
  steps:[['Finance manager','#2979ff','See what is still open','Open invoices, unapproved bills and disputes are counted in the queues.',''],['Finance manager','#2979ff','Give each loose end an owner','Each one becomes a task with an assignee and a completion date on the calendar.',''],['AP','#00b8d9','Bills are matched and routed','AP checks bills against goods receipts and routes them for approval.',''],['Owner','#ffb800','Plan the payment run','Approved bills are grouped into a run for a person to release.','planned'],['Auditor','#7b61ff','Close against a checklist','A checklist ties each close step to the records it covers.','planned']],
  result:'The close becomes a list of records with owners, not a week of hunting.'},
 {id:'deadline',tab:'Team deadline',color:'#7b61ff',q:'What happens when work needs an owner and a date?',big:'Due Friday',module:'Calendar',role:'finance_manager',page:'calendar',
  steps:[['Finance manager','#2979ff','Assign the work','Pick a person, a priority and a completion date.',''],['AR','#00c853','It shows up in their week','The task appears on the assignee’s calendar alongside the team’s meetings.',''],['AR','#00c853','Progress is visible','Open, in progress, done: the status is shared with the team.',''],['Owner','#ffb800','Meetings sit beside the work','Reviews and syncs are on the same calendar as the deadlines.',''],['Finance manager','#2979ff','Late work stands out','A task past its date is marked overdue for a person to follow up.','']],
  result:'Every deadline has a name next to it.'}
];
const l3Roles=[
 {id:'owner',tab:'Owner',place:'THE OWNER’S DESK',color:'#ffb800',title:'See the whole business on one screen and act on what needs a decision.',feats:[['▦','Owner view','Receivables, payables and approvals in one place.',''],['✓','Approvals','Approve or reject invoices and bills with the record open.',''],['◷','Team calendar','Meetings and assigned work, with owners and dates.',''],['◎','Connections','The businesses you trade with, and what each one sees.',''],['↗','Cash-flow forecast','Expected receipts and payments, week by week.','planned'],['⌁','Flow insights','Where work is building up across the queues.','']]},
 {id:'finance_manager',tab:'Finance manager',place:'FINANCE DESK',color:'#2979ff',title:'Balance the work across AR and AP, and give every loose end an owner.',feats:[['◷','Assign work','Tasks with an assignee, a priority and a date.',''],['▦','Both queues','Receivables and payables side by side.',''],['✓','Approvals','Decide on invoices and bills in review.',''],['⌁','Flow insights','Due-date pressure and exceptions by queue.',''],['☑','Close checklist','Month-end steps tied to their records.','planned'],['₹','Payment run','Group approved bills for a person to release.','planned']]},
 {id:'ar',tab:'AR',place:'RECEIVABLES',color:'#00c853',title:'Get invoices out, answered and paid.',feats:[['▤','Invoice builder','GSTINs and the GST split calculated as you type.',''],['!','Overdue queue','Invoices past their due date, in one list.',''],['✎','Reminder drafts','Prepared on the record; a person sends.','sim'],['⚑','Dispute replies','Answer the buyer on the invoice itself.',''],['☰','Collections workbench','Promises to pay and follow-ups per customer.','planned'],['◷','My tasks','The chases assigned to you, with dates.','']]},
 {id:'ap',tab:'AP',place:'PAYABLES',color:'#00b8d9',title:'Move vendor bills from the inbox to approved.',feats:[['▤','Bills inbox','Bills from connected vendors and uploads.',''],['⇪','Bill capture','Fields read from an uploaded bill for review.','sim'],['✓','Route for approval','Send a bill to an approver with its PO.',''],['₹','Payment status','Record a bill as paid and share the status.','sim'],['⇶','Payment run','Batch approved bills for release.','planned'],['★','Vendor scorecards','Accuracy and timeliness per vendor.','planned']]},
 {id:'approver',tab:'Approver',place:'DECISIONS',color:'#7b61ff',title:'Decide with the record in front of you.',feats:[['✓','Approval queue','Everything waiting for your decision.',''],['▤','Full context','Amount, PO, GST and history on one screen.',''],['⚑','Ask before deciding','Raise a question on the record.',''],['↺','Decision on record','Your yes or no stays attached to the bill.','']]},
 {id:'auditor',tab:'Auditor / CA',place:'AUDIT',color:'#ff6b35',title:'Read everything that happened. Change nothing.',feats:[['◉','Read-only view','Every queue visible, no edit buttons.',''],['≡','Activity trail','Who did what to which record, and when.',''],['%','GST details','GSTINs, rates and totals on each invoice.',''],['⇄','Return matching','Invoices matched against filed returns.','planned']]},
 {id:'buyer_portal',tab:'Buyer portal',place:'TRADING PARTNER',color:'#ff2d95',title:'Review a supplier’s invoice and answer on the record.',feats:[['▤','Shared invoice','The same record the supplier sees.',''],['⚑','Raise a query','Dispute with a reason, in context.',''],['₹','Share payment status','Mark an invoice paid for the supplier to see.','sim'],['◎','Scoped sharing','Only what the connection allows.','']]},
 {id:'vendor_portal',tab:'Vendor portal',place:'TRADING PARTNER',color:'#00b8d9',title:'See your invoices the way your buyer sees them.',feats:[['▤','Sent invoices','Every invoice shared with the buyer.',''],['↻','Buyer-side status','Viewed, queried, approved or paid.',''],['⚑','Replies','Questions and answers stay on the invoice.',''],['◉','Read-only','A view of shared records, not a login to theirs.','']]}
];
const l3Cats=[['ar','Receivables','#00c853'],['ap','Payables','#ff2d95'],['control','Approvals & control','#7b61ff'],['network','Network','#00b8d9'],['tax','Tax & GST','#ffb800'],['team','Team & work','#2979ff'],['insight','Insights','#ff6b35']];
const l3Modules=[
 ['ar','Invoices','Create, share and follow invoices with connected buyers.','live','invoices'],
 ['ar','Invoice builder','Line items, GSTINs and the GST split as you type.','live','builder'],
 ['ar','Overdue queue','Invoices past their due date, gathered in one list.','live','invoices'],
 ['ar','Reminder drafts','A reminder prepared on the invoice. A person sends it.','sim',''],
 ['ar','Collections workbench','Promises to pay and follow-ups per customer.','planned',''],
 ['ap','Bills inbox','Vendor bills from connections and uploads in one place.','live','bills'],
 ['ap','Bill capture','Fields read from an uploaded bill, for a person to check.','sim','billUpload'],
 ['ap','Payment status','Record a bill as paid and share the update.','sim','payments'],
 ['ap','Payment run','Group approved bills for a person to release.','planned',''],
 ['ap','Vendor scorecards','Bill accuracy, timeliness and disputes per vendor.','planned',''],
 ['control','Approvals','Invoices and bills routed to a person who decides.','live','approvals'],
 ['control','Disputes','Questions and replies kept on the invoice.','live','disputes'],
 ['control','Activity trail','Who did what, to which record, and when.','live','activity'],
 ['control','Auditor view','Read-only access to every queue and the trail.','live',''],
 ['network','Connections','Link buyers and vendors and choose what each sees.','live','connections'],
 ['network','Buyer and vendor portals','Your partners see the shared record, not a copy.','live','portal'],
 ['tax','GST on invoices','GSTINs and the GST split on every invoice.','live','builder'],
 ['tax','GST return matching','Invoices matched against filed returns.','planned',''],
 ['tax','E-invoice (IRN)','Registering invoices with the e-invoice portal.','planned',''],
 ['team','Calendar & work assignment','Meetings and tasks with owners and completion dates.','live','calendar'],
 ['team','Team workload','Where each role’s queue is building up.','live','team'],
 ['insight','Flow insights','Due-date pressure, queues and exceptions.','live','insights'],
 ['insight','Cash-flow forecast','Expected receipts and payments, week by week.','planned',''],
 ['insight','Month-end close checklist','Close steps tied to the records they cover.','planned','']
];
function l3Data(){
 const S=state||{},inv=S.invoices||[],bills=S.bills||[],cal=S.calendar_events||[],staff=S.staff||[];
 const open=inv.filter(i=>i.supplier==='northstar'&&!['Draft','Paid','Rejected','Resolved'].includes(i.status));
 const billsOpen=bills.filter(b=>b.buyer==='meridian'&&!['Paid','Rejected'].includes(b.status));
 const tasks=cal.filter(e=>e.kind==='task'),openTasks=tasks.filter(t=>!['Done','Cancelled'].includes(t.status));
 const day=s=>{const d=new Date(String(s||'')+'T00:00:00');return isNaN(d)?null:d};
 const today=new Date();today.setHours(0,0,0,0);
 return {inv,bills,open,billsOpen,tasks,openTasks,
  overdue:inv.filter(i=>i.status==='Overdue'),disputes:inv.filter(i=>i.status==='Dispute'),
  review:bills.filter(b=>['Needs approval','Received'].includes(b.status)),
  paid:inv.find(i=>i.status==='Paid')||inv[0]||null,
  meetings:cal.filter(e=>e.kind==='meeting'&&e.status!=='Cancelled'),
  close:cal.find(e=>/month-end/i.test(e.title||''))||null,
  recv:open.reduce((n,i)=>n+Number(i.total||0),0),pay:billsOpen.reduce((n,b)=>n+Number(b.amount||0),0),
  partners:(S.connections||[]).filter(c=>c.status==='Connected').length,calCount:cal.length,
  who:id=>(staff.find(s=>s.id===id)||{}).name||'A teammate',
  late:d=>{const x=day(d);return x?Math.round((today-x)/864e5):0}};
}
function l3Gst(i){
 if(!i)return null;const taxable=Number(i.rate||0)*Number(i.qty||1),rate=Number(i.tax||0),gst=Math.round(taxable*rate)/100;
 const inter=String(i.supplier_gstin||'').slice(0,2)!==String(i.customer_gstin||'').slice(0,2);
 return {taxable,rate,gst,inter,total:Number(i.total||taxable+gst)};
}
function l3Board(cls){
 const tiles=l3Threads.map((t,i)=>`<span class="l3-tile" data-l3-tile="${i}" style="--c:${t.color}"><i aria-hidden="true">${t.icon}</i>${esc(t.tile)}</span>`).join('');
 return `<div class="l3-board ${cls||''}" aria-hidden="true"><div class="l3-board-head"><span class="l3-logo"><i></i><i></i><i></i><i></i></span>${esc(company('northstar').name||'Northstar Studio')}<em>One record</em></div><div class="l3-board-grid">${tiles}<span class="l3-tile l3-tile-ai"><i>✦</i>Drafts wait. A person decides.</span></div></div>`;
}
function l3Mini(head,color,body,foot){return `<div class="l3-mini" style="--c:${color}"><div class="l3-mini-head">${head}</div><div class="l3-mini-body">${body}</div><div class="l3-mini-foot">${esc(foot)}</div></div>`}
function l3Art(t,d){
 const name=id=>esc(company(id).name),row=(a,b,c)=>`<div class="l3-mrow"><span>${a}</span><span>${b}</span><b>${c}</b></div>`,pill=s=>`<em class="l3-st">${esc(s)}</em>`;
 if(t.key==='sheet'){const rows=d.open.slice(0,3).map(i=>row(esc(i.id),name(i.customer),pill(i.status))).join('')||row('—','No open invoices','');return l3Mini('Receivables · '+esc(company('northstar').name),t.color,rows,'Read from the sample invoices.')}
 if(t.key==='chase'){const o=d.overdue[0];const body=o?`${row(esc(o.id),name(o.customer),cash(o.total))}<div class="l3-bubble"><small>Draft · not sent</small>Hello, a gentle reminder that ${esc(o.id)} for ${cash(o.total)} was due on ${esc(dateFmt(o.due_date))}.</div><div class="l3-mnote">${Math.max(0,d.late(o.due_date))} days past due</div>`:'<div class="l3-mnote">No overdue invoices in the sample data right now.</div>';return l3Mini('Overdue · follow-up',t.color,body,'Drafted on the record. A person sends it.')}
 if(t.key==='approval'){const rows=d.review.slice(0,2).map(b=>`${row(esc(b.id),name(b.vendor),cash(b.amount))}<div class="l3-mact"><span>Approve</span><span>Reject</span><small>${esc(b.po_number||'')}</small></div>`).join('')||'<div class="l3-mnote">Nothing is waiting for a decision.</div>';return l3Mini(`Waiting for a decision · ${d.review.length}`,t.color,rows,'The approver sees the bill and its PO.')}
 if(t.key==='gst'){const i=d.open[0]||d.inv[0],g=l3Gst(i);const body=g?`${row('Taxable value','',cash(g.taxable))}${g.inter?row(`IGST ${g.rate}%`,'',cash(g.gst)):row(`CGST ${g.rate/2}%`,'',cash(g.gst/2))+row(`SGST ${g.rate/2}%`,'',cash(g.gst/2))}${row('Invoice total','',cash(g.total))}<div class="l3-mnote">${esc(i.supplier_gstin||'')} → ${esc(i.customer_gstin||'')}</div>`:'<div class="l3-mnote">No invoices loaded.</div>';return l3Mini('GST · '+esc(i?i.id:'invoice'),t.color,body,'Return filing is planned, not in this demo.')}
 if(t.key==='pile'){const src={network:'Connected vendor',upload:'Upload',manual:'Typed in'};const rows=d.bills.filter(b=>b.buyer==='meridian').slice(0,3).map(b=>row(esc(b.id),esc(src[b.source]||b.source||''),pill(b.status))).join('')||row('—','No bills','');return l3Mini('AP inbox · '+esc(company('meridian').name),t.color,rows,'Field extraction is simulated on sample bills.')}
 if(t.key==='close'){const c=d.close;const body=`<ul class="l3-check"><li><b>${d.open.length}</b> invoices still open</li><li><b>${d.review.length}</b> bills waiting for review</li><li><b>${d.disputes.length}</b> disputes to answer</li><li><b>${d.openTasks.length}</b> team tasks still open</li></ul>${c?`<div class="l3-mnote">${esc(c.title)} · ${esc(dateFmt(c.start_date))}</div>`:''}`;return l3Mini('Before month-end',t.color,body,'Counts read from the sample records.')}
 const body=`<div class="l3-quad"><span><small>Receivable</small>${cash(d.recv)}</span><span><small>Payable</small>${cash(d.pay)}</span><span><small>Approvals</small>${d.review.length} waiting</span><span><small>Team tasks</small>${d.openTasks.length} open</span></div>`;
 return l3Mini('Today · whole business',t.color,body,'One view of the day, with flags.');
}
function l3Case(c,d,i){
 const steps=c.steps.map((s,n)=>`<li style="--rc:${s[1]}"><span class="l3-num">${n+1}</span><div><p class="l3-step-top"><span class="l3-who"><i></i>${esc(s[0])}</span>${s[4]?l3Tag(s[4]):''}</p><h4>${esc(s[2])}</h4><p>${esc(s[3])}</p></div></li>`).join('');
 let fact='';
 if(c.id==='overdue'){const o=d.overdue[0];fact=o?`${esc(o.id)} · ${esc(company(o.customer).name)} · ${cash(o.total)} · ${Math.max(0,d.late(o.due_date))} days past due`:'No overdue invoice in the sample data right now.'}
 if(c.id==='dispute'){const o=d.disputes[0];fact=o?`${d.disputes.length} open · ${esc(o.id)}: “${esc(o.dispute_reason||'Query raised')}”`:'No open disputes in the sample data.'}
 if(c.id==='vendor')fact=`${d.partners} connections in the sample network`;
 if(c.id==='close')fact=d.close?`${esc(d.close.title)} · ${esc(dateFmt(d.close.start_date))}`:`${d.open.length} invoices and ${d.review.length} bills still open`;
 if(c.id==='deadline'){const t=d.openTasks[0];fact=t?`“${esc(t.title)}” · ${esc(d.who(t.assignee_staff))} · due ${esc(dateFmt(t.due_date))}`:'No open tasks on the sample calendar.'}
 return `<div class="l3-case" role="tabpanel" id="l3-case-${c.id}" aria-labelledby="l3-casetab-${c.id}" data-l3-case="${c.id}" ${i?'hidden':''} style="--cc:${c.color}"><div class="l3-case-flow"><h3>${esc(c.q)}</h3><ol class="l3-steps">${steps}</ol><p class="l3-result">→ ${esc(c.result)}</p></div><div class="l3-case-side"><div class="l3-poster"><span class="l3-chip">${esc(c.module)}</span><b>${esc(c.big)}</b><span class="l3-poster-fact">${fact}</span><a class="l3-btn l3-btn-gold" href="/demo?role=${esc(c.role)}&amp;page=${esc(c.page)}">Open this in the demo <span aria-hidden="true">→</span></a><i class="l3-poster-band" aria-hidden="true"></i></div><p class="l3-fine">Illustration with sample data. The button opens the working demo.</p></div></div>`;
}
function l3Role(r,i){
 const feats=r.feats.map(f=>`<li><span class="l3-ficon" aria-hidden="true">${f[0]}</span><div><b>${esc(f[1])}</b>${f[3]?' '+l3Tag(f[3]):''}<p>${esc(f[2])}</p></div></li>`).join('');
 return `<div class="l3-role-panel" role="tabpanel" id="l3-role-${r.id}" aria-labelledby="l3-roletab-${r.id}" data-l3-rolepanel="${r.id}" ${i?'hidden':''} style="--rc:${r.color}"><h3>${esc(r.title)}</h3><div class="l3-row"><a class="l3-btn l3-btn-gold" href="/demo?role=${esc(r.id)}">Try the ${esc(r.tab)} demo <span aria-hidden="true">→</span></a><span class="l3-fine">${esc(profiles[r.id]?profiles[r.id].label:'')}</span></div><ul class="l3-feats">${feats}</ul></div>`;
}
function l3Weave(){
 const C=['#00b8d9','#ff2d95','#7b61ff','#ffb800','#00c853','#ff6b35','#2979ff','#00c853','#ff2d95'];let s='',n=9,g=30,o=20,L=o+g*(n-1);
 const bar=(x1,y1,x2,y2,c)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1f2937" stroke-width="17" stroke-linecap="round"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="11" stroke-linecap="round"/>`;
 for(let c=0;c<n;c++)s+=bar(o+c*g,4,o+c*g,L+16,C[c]);
 for(let r=0;r<n;r++)s+=bar(4,o+r*g,L+16,o+r*g,C[(r+4)%n]);
 for(let r=0;r<n;r++)for(let c=0;c<n;c++)if((r+c)%2===0)s+=bar(o+c*g,o+r*g-11,o+c*g,o+r*g+11,C[c]);
 return `<svg class="l3-weave" viewBox="-10 -10 ${L+46} ${L+46}" aria-hidden="true" focusable="false"><g transform="rotate(-10 ${L/2} ${L/2})">${s}</g></svg>`;
}
function pageLanding(){
 const d=l3Data(),T=l3Threads,live=l3Modules.filter(m=>m[3]==='live').length,roleCount=Object.keys(profiles).length;
 const nav=[['#threads','The problem'],['#usecases','Use cases'],['#people','Roles'],['#ai','AI'],['#modules','Modules'],['#trust','Trust']];
 const navLinks=nav.map(n=>`<a href="${n[0]}">${n[1]}</a>`).join('');
 const papers=T.map((t,i)=>`<button type="button" class="l3-paper l3-paper-${i}" data-l3-goto="${i}" style="--c:${t.color}" aria-label="Loose thread ${i+1}: ${esc(t.paper)}"><small>TODAY</small><i aria-hidden="true">${t.icon}</i><span>${esc(t.paper)}</span></button>`).join('');
 const threadCards=T.map((t,i)=>`<article class="l3-thread${i?'':' on'}" data-l3-step="${i}" style="--c:${t.color}"><div class="l3-thread-card"><p class="l3-kick"><i></i>LOOSE THREAD ${i+1} OF ${T.length} · ${esc(t.paper.toUpperCase())}</p><h3>${esc(t.pain)}</h3><p class="l3-problem">${esc(t.problem)}</p><p class="l3-with"><small>WITH INVOICEOS</small>${esc(t.fix)}</p><p class="l3-tags">${t.tags.map(g=>l3Tag(g[0],g[1])).join('')}</p></div><div class="l3-thread-art">${l3Art(t,d)}</div></article>`).join('')+
  `<article class="l3-thread l3-thread-idea" data-l3-step="${T.length}" id="idea"><div class="l3-thread-card"><p class="l3-kick"><i></i>THE IDEA</p><h3>One record. Every thread connected.</h3><p class="l3-problem">Raise an invoice and the buyer, the approver, the AP desk and the auditor are reading the same row. Approve a bill and the due list, the calendar and the owner’s view move together. The whole finance desk, woven into one record.</p><p><a class="l3-btn l3-btn-gold" href="#usecases">See it happen <span aria-hidden="true">↓</span></a></p></div></article>`;
 const dots=[...T.map(t=>t.paper),'The idea'].map((p,i)=>`<button type="button" class="l3-dot${i?'':' on'}" data-l3-goto="${i}" style="--c:${(T[i]||{color:'#ffd84d'}).color}" aria-label="${i+1}. ${esc(p)}"></button>`).join('');
 const catOf=k=>l3Cats.find(c=>c[0]===k)||l3Cats[0];
 const pills=l3Modules.map(m=>`<span class="l3-pill" style="--c:${catOf(m[0])[2]}"><i></i>${esc(m[1])}</span>`).join('');
 const half=Math.ceil(l3Modules.length/2),pillsA=l3Modules.slice(0,half).map(m=>`<span class="l3-pill" style="--c:${catOf(m[0])[2]}"><i></i>${esc(m[1])}</span>`).join(''),pillsB=l3Modules.slice(half).map(m=>`<span class="l3-pill" style="--c:${catOf(m[0])[2]}"><i></i>${esc(m[1])}</span>`).join('');
 const caseTabs=l3Cases.map((c,i)=>`<button type="button" role="tab" id="l3-casetab-${c.id}" aria-controls="l3-case-${c.id}" aria-selected="${!i}" tabindex="${i?-1:0}" class="l3-ptab" data-l3-casetab="${c.id}" style="--c:${c.color}"><i></i>${esc(c.tab)}</button>`).join('');
 const roleTabs=l3Roles.map((r,i)=>`<button type="button" role="tab" id="l3-roletab-${r.id}" aria-controls="l3-role-${r.id}" aria-selected="${!i}" tabindex="${i?-1:0}" class="l3-rtab" data-l3-roletab="${r.id}" style="--c:${r.color}"><small>${esc(r.place)}</small><b>${esc(r.tab)}</b></button>`).join('');
 const catPills=`<button type="button" class="l3-ptab on" aria-pressed="true" data-l3-cat="all"><i></i>All <span>${l3Modules.length}</span></button>`+l3Cats.map(c=>`<button type="button" class="l3-ptab" aria-pressed="false" data-l3-cat="${c[0]}" style="--c:${c[2]}"><i></i>${esc(c[1])} <span>${l3Modules.filter(m=>m[0]===c[0]).length}</span></button>`).join('');
 const modCards=l3Modules.map(m=>{const c=catOf(m[0]),inner=`<small>${esc(c[1].toUpperCase())}</small><b>${esc(m[1])}</b><p>${esc(m[2])}</p>${l3Tag(m[3])}`;return m[4]?`<a class="l3-mod l3-mod-${m[3]}" data-l3-mod="${m[0]}" href="/demo?page=${esc(m[4])}" style="--c:${c[2]}">${inner}<em>Open <span aria-hidden="true">→</span></em></a>`:`<div class="l3-mod l3-mod-${m[3]}" data-l3-mod="${m[0]}" style="--c:${c[2]}">${inner}</div>`}).join('');
 const checks=T.map((t,i)=>`<label class="l3-checkrow" style="--c:${t.color}"><input type="checkbox" data-l3-weave="${i}"><span class="l3-box" aria-hidden="true">✓</span><span><b>${esc(t.paper.replace(/^The /,'The '))}</b><small>${esc(t.pain)}</small></span></label>`).join('');
 const loom=Array.from({length:7},(_,i)=>`<i style="--i:${i}"></i>`).join('');
 const g=l3Gst(d.paid);
 const receipt=d.paid&&g?`<div class="l3-receipt-line"><span>${esc(d.paid.description||'Services')}</span><b>${cash(g.taxable)}</b></div><div class="l3-receipt-line"><span>GST ${g.rate}%</span><b>${cash(g.gst)}</b></div><div class="l3-receipt-line l3-receipt-total"><span>Total · ${esc(d.paid.status)}</span><b>${cash(g.total)}</b></div>`:`<div class="l3-receipt-line"><span>Sample invoice</span><b>—</b></div>`;
 const B=(href,label,cls)=>`<a class="l3-btn ${cls||''}" href="${href}">${label}</a>`;
 return `<div class="landing landing-v2 landing-v3">
<header class="l3-header"><a class="l3-brand" href="#top" aria-label="InvoiceOS home"><span class="brand-icon">▣</span><span>invoiceOS</span></a><nav class="l3-nav" aria-label="Main menu">${navLinks}</nav><div class="l3-header-actions"><button class="theme-toggle l3-theme" type="button" data-theme-toggle aria-label="Switch to dark theme" aria-pressed="false" title="Switch to dark theme"><span class="theme-icon sun" aria-hidden="true">☀</span><span class="theme-icon moon" aria-hidden="true">☾</span></button><a class="l3-signin" href="/demo?pick=1">Choose a role</a><a class="l3-book" href="#book">Book a demo</a><button type="button" class="l3-menu-btn" data-l3-menu aria-expanded="false" aria-controls="l3-menu" aria-label="Open navigation">☰</button></div><nav class="l3-menu" id="l3-menu" aria-label="Mobile menu" hidden>${navLinks}<a href="/demo?pick=1">Choose a role →</a></nav></header>
<main id="top">
<section class="l3-hero"><div class="l3-hero-copy"><p class="l3-eyebrow"><span class="l3-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>INVOICEOS · FINANCE OPERATING SYSTEM</p><h1>The whole finance desk, <span class="l3-woven">woven</span> into one record.</h1><p class="l3-lede">A finance team runs on loose threads: an invoice spreadsheet, a WhatsApp payment chase, an approval email chain. InvoiceOS puts invoices, vendor bills, approvals, GST details, trading partners and team deadlines on one shared record, with drafts that wait for a person to decide.</p><div class="l3-row">${B('/demo?pick=1','Try a demo <span aria-hidden="true">→</span>','l3-btn-gold l3-btn-lg')}${B('#threads','<span aria-hidden="true">↓</span> Follow the seven loose threads','l3-btn-lg')}</div><p class="l3-micro">No sign-up: pick one of ${roleCount} roles and look around a sample business. Or <a href="#explore">spin the record</a>.</p></div>
<div class="l3-hero-art"><p class="l3-art-note">Illustration with sample data</p>${l3Board('l3-board-hero')}${papers}</div></section>
<section class="l3-story" id="threads" data-l3-story data-step="0" aria-label="Seven loose threads"><div class="l3-story-pin"><div class="l3-story-head"><p class="l3-eyebrow">THE LOOSE THREADS</p><h2>Seven places finance work slips through.</h2></div><div class="l3-story-stage">${l3Board('l3-board-story')}<div class="l3-threads">${threadCards}</div></div><div class="l3-progress"><div class="l3-dots" role="group" aria-label="Story steps">${dots}</div><p class="l3-hint"><span aria-hidden="true">↕</span> Scroll: each loose thread becomes part of one record. Select a dot to jump.</p><a class="l3-skip" href="#numbers">Skip the story</a></div></div></section>
<section class="l3-ticker-wrap" id="numbers" aria-label="Modules and numbers"><div class="l3-ticker" aria-hidden="true"><div class="l3-track">${pillsA}${pillsA}</div><div class="l3-track l3-track-rev">${pillsB}${pillsB}</div></div><p class="sr-only">Modules: ${l3Modules.map(m=>esc(m[1])).join(', ')}.</p>
<div class="l3-wrap l3-stats"><div class="l3-stat" style="--c:#00c853"><b data-count="${l3Modules.length}">${l3Modules.length}</b><span>modules</span><p>${live} work in this demo today. The rest are marked simulated or planned.</p></div><div class="l3-stat" style="--c:#7b61ff"><b data-count="${roleCount}">${roleCount}</b><span>roles</span><p>Each person opens their own view of the same records.</p></div><div class="l3-stat" style="--c:#ff6b35"><b data-count="${Math.round(d.recv)}" data-money="1">${cash(d.recv)}</b><span>open receivables</span><p>${d.open.length} invoices in the sample business, read live from the demo.</p></div><div class="l3-stat" style="--c:#2979ff"><b data-count="${d.calCount}">${d.calCount}</b><span>calendar entries</span><p>Meetings and assigned tasks on the sample team calendar.</p></div></div></section>
<section class="l3-sec" id="usecases"><div class="l3-wrap"><div class="l3-head"><p class="l3-eyebrow">USE CASES</p><h2>Follow one thread through the finance desk.</h2><p>Five everyday moments. Each step shows who acts, what InvoiceOS does for them and how far the demo goes.</p></div><div class="l3-ptabs" role="tablist" aria-label="Use cases" data-l3-tabs="case">${caseTabs}</div>${l3Cases.map((c,i)=>l3Case(c,d,i)).join('')}</div></section>
<section class="l3-sec" id="people"><div class="l3-wrap"><div class="l3-head"><p class="l3-eyebrow">WHO USES IT</p><h2>${roleCount} roles. One finance record.</h2><p>Each person opens their own view of the same records. Pick one, then try their view on the sample business.</p></div><div class="l3-rtabs" role="tablist" aria-label="Roles" data-l3-tabs="role">${roleTabs}</div><div class="l3-role-box">${l3Roles.map(l3Role).join('')}</div><p class="l3-fine l3-note">${roleCount} roles in all: owner, finance manager, AR, AP, approver, auditor, and the buyer and vendor portals. In this demo the role switcher is a viewpoint, not access control.</p></div></section>
<section class="l3-ai" id="ai"><div class="l3-wrap"><div class="l3-ai-top"><div class="l3-head"><p class="l3-eyebrow">THE DRAFTING LAYER</p><h2>Drafts are prepared. A person decides.</h2><p>Reminders, replies and bill fields arrive as drafts on the record. Every one of them stops at the same line.</p><p class="l3-nevers">${['Payments','GST filing','Approvals','Sending messages'].map(x=>`<span>⊘ ${x}</span>`).join('')}</p></div><div><div class="l3-draft" data-draft-card><p class="l3-draft-top">${l3Tag('sim','Draft')}<span>Payment reminder to ${esc(d.overdue[0]?company(d.overdue[0].customer).name:'a customer')} · not sent</span></p><p class="l3-draft-copy" data-draft-copy>${d.overdue[0]?`Hello, a gentle reminder that invoice ${esc(d.overdue[0].id)} for ${cash(d.overdue[0].total)} was due on ${esc(dateFmt(d.overdue[0].due_date))}. Could you share an expected payment date? The invoice is attached to this record.`:'Hello, a gentle reminder that an invoice from us is now past its due date. Could you share an expected payment date?'}</p><div class="l3-row"><button type="button" class="l3-btn l3-btn-gold" data-draft-save>✓ Save</button><button type="button" class="l3-btn" data-draft-edit>✎ Edit first</button><button type="button" class="l3-btn" data-draft-drop>⌫ Discard</button></div></div><p class="l3-ask-label">Now ask it for something it must not do:</p><button type="button" class="l3-btn l3-ask" data-l3-ask="0">Mark ${esc(d.overdue[0]?d.overdue[0].id:'this invoice')} as paid</button><p class="l3-refusal" data-l3-refusal aria-live="polite"></p><p class="l3-fine">In this demo drafts come from templates over the sample records. No AI model is called and nothing is sent.</p></div></div>
<div class="l3-grid4">${[['It drafts, you save','Reminders, dispute replies and bill fields arrive as drafts. Nothing is stored until a person saves it.',''],['It never does these','Moving money, filing GST returns, approving bills and sending messages are left to people.',''],['It reads what your role reads','A draft for AR is built from AR’s records. In this demo the role switcher is a viewpoint, not access control.',''],['You set the limits','Which drafts each role gets, switched on or off per role.','planned']].map((c,i)=>`<article class="l3-card"><span class="l3-num">${i+1}</span><h3>${esc(c[0])}${c[2]?' '+l3Tag(c[2]):''}</h3><p>${esc(c[1])}</p></article>`).join('')}</div>
<div class="l3-explore" id="explore"><div class="l3-head"><h3 class="l3-h3">Spin the record.</h3><p>Every area of the demo hangs off the same record. The counts on each node are read from the sample data. Drag to spin it, pick an area to read about it, then open it.</p><p class="l3-fine">Keyboard: Tab to an area and press Enter.</p></div><div class="l3-orb-frame">${orbStageMarkup(false)}</div></div></div></section>
<section class="l3-sec" id="modules"><div class="l3-wrap"><div class="l3-head"><p class="l3-eyebrow">EVERYTHING IN THE BOX</p><h2>${l3Modules.length} modules. Start with what you need.</h2><p>${live} are live in this demo. The others say plainly whether they are simulated or planned, here and on screen.</p></div><div class="l3-search"><label class="sr-only" for="l3-mod-q">Find a module</label><span aria-hidden="true">⌕</span><input id="l3-mod-q" type="search" placeholder="Find a module, e.g. GST, payment run, calendar" autocomplete="off" data-l3-q></div><div class="l3-cats" role="group" aria-label="Filter modules by area">${catPills}</div><p class="sr-only" aria-live="polite" data-l3-count></p><div class="l3-mods">${modCards}</div><div class="l3-empty" data-l3-empty hidden><b>No module matches that.</b><p>Try “GST”, “bills” or “calendar”, or clear the search.</p><button type="button" class="l3-btn" data-l3-clear>Clear search</button></div></div></section>
<section class="l3-sec" id="begin"><div class="l3-wrap"><div class="l3-head"><p class="l3-eyebrow">WHERE TO BEGIN</p><h2>Which loose threads does your finance desk run on?</h2><p>Tick what you still use today. Each one is woven in, with the modules that replace it.</p></div><div class="l3-begin"><div class="l3-checks" data-l3-weaver>${checks}</div><div class="l3-loom-card"><div class="l3-loom" aria-hidden="true">${loom}<div class="l3-wefts" data-l3-wefts></div></div><p data-l3-weave-msg><b>Nothing woven yet.</b> Tick a loose thread and it crosses the loom.</p><div class="l3-weave-mods" data-l3-weave-mods></div><a class="l3-btn" href="#book">Book a demo <span aria-hidden="true">→</span></a></div></div></div></section>
<section class="l3-sec" id="trust"><div class="l3-wrap"><div class="l3-head"><p class="l3-eyebrow">WHY A FINANCE TEAM CAN RELY ON IT</p><h2>Built so the record can be trusted.</h2><p>Four rules the product is built around, and that this demo follows on its sample records.</p></div><div class="l3-trust"><div class="l3-rules">${[['Every record names its businesses','Each invoice carries its supplier and customer with their GSTINs. A connection shares only the scopes both sides switched on.'],['A person on every decision','Approvals, disputes and payment status change only when a person in that role acts.'],['History written in ink','The activity trail keeps who did what, to which record, and when. A correction is a new entry beside the old one.'],['Labels that tell the truth','If a feature is simulated or planned, the screen says so in words, and so does this page.']].map((r,i)=>`<article class="l3-card"><span class="l3-num">${i+1}</span><h3>${esc(r[0])}</h3><p>${esc(r[1])}</p></article>`).join('')}</div><div class="l3-receipt-wrap" data-l3-lock><div class="l3-receipt"><p class="l3-receipt-head"><b>${esc(d.paid?d.paid.id:'Invoice')}</b><span class="l3-locked">🔒 Locked</span></p><p class="l3-fine">${esc(d.paid?company(d.paid.customer).name:'')}</p>${receipt}</div><div class="l3-row"><button type="button" class="l3-btn" data-l3-lock-edit>✎ Edit the amount</button><button type="button" class="l3-btn l3-btn-gold" data-l3-lock-fix>+ Add a correction</button></div><p class="l3-verdict" data-l3-verdict aria-live="polite"></p><p class="l3-fine">Illustration with numbers from a sample invoice. It shows the rule; nothing here is saved.</p></div></div></div></section>
<section class="l3-sec" id="start"><div class="l3-wrap"><div class="l3-head"><p class="l3-eyebrow">GETTING STARTED</p><h2>Three steps from spreadsheet to shared record.</h2></div><div class="l3-steps3">${[['#00c853','Pick a role','Open the demo as the owner, AR, AP or any of the '+roleCount+' roles. No sign-up, no setup.'],['#ffb800','Follow one record','Open an overdue invoice or a bill waiting for approval, and move it a step.'],['#ff2d95','Give the next step an owner','Put the follow-up on the team calendar with an assignee and a date.']].map((s,i)=>`<article class="l3-card"><span class="l3-bignum" style="--c:${s[0]}">${i+1}</span><h3>${esc(s[1])}</h3><p>${esc(s[2])}</p></article>`).join('')}</div>
<div class="l3-plain" id="plainly"><h3 class="l3-h3">Stated plainly</h3><p class="l3-fine">What is not finished, in the same words the product uses on screen.</p><ul>${[['live','Invoices, bills, approvals, disputes, connections, the team calendar and insights work on sample records in this local demo.'],['sim','Bill field extraction, reminder drafts and payment status updates are simulated. Nothing is sent and no money moves.'],['planned','Cash-flow forecast, collections workbench, payment run, vendor scorecards, the month-end checklist and GST return filing are planned.'],['note','The role switcher shows each viewpoint. There is no sign-in and no access control in this demo.']].map(r=>`<li>${l3Tag(r[0],r[0]==='note'?'Not access control':'')}<span>${esc(r[1])}</span></li>`).join('')}</ul></div></div></section>
<section class="l3-cta" id="book"><div class="l3-wrap l3-cta-grid"><div><p class="l3-eyebrow">YOUR TURN</p><h2>The whole finance desk, woven into one record.</h2><p>See it with your own business in mind, or walk in right now as any of the ${roleCount} roles. To book a guided walkthrough, ask the person who shared this demo with you.</p><div class="l3-row">${B('/demo?pick=1','Try a demo <span aria-hidden="true">→</span>','l3-btn-ink')}${B('/demo?role=owner','Open the owner view')}</div><ul class="l3-ways">${[['#threads','↕ Follow the threads','Seven loose threads, one record, in one scroll.'],['#explore','◎ Spin the record','The demo’s areas, with counts from the sample data.'],['#modules','☰ Compare modules','What is live, simulated or planned, side by side.']].map(w=>`<li><a class="l3-btn" href="${w[0]}">${w[1]}</a><span>${w[2]}</span></li>`).join('')}</ul></div><div class="l3-cta-art">${l3Weave()}</div></div></section>
</main>
<footer class="l3-footer"><div class="l3-wrap"><div class="l3-foot-cols"><div class="l3-foot-brand"><a class="l3-brand" href="#top"><span class="brand-icon">▣</span><span>invoiceOS</span></a><p>InvoiceOS puts a business’s invoices, vendor bills, approvals, GST details, trading partners and team deadlines on one shared record.</p><p><b>Your finance desk. Your partners. One record.</b></p></div><nav aria-label="The story"><h4>The story</h4><a href="#threads">Loose threads</a><a href="#idea">The idea</a><a href="#usecases">Use cases</a><a href="#people">Roles</a></nav><nav aria-label="Product"><h4>Product</h4><a href="#ai">Drafting layer</a><a href="#explore">Explorer</a><a href="#modules">Modules</a><a href="#trust">Trust</a><a href="#plainly">Stated plainly</a></nav><nav aria-label="Open the demo"><h4>Open the demo</h4><a href="/demo?role=owner">Owner</a><a href="/demo?role=ar">AR</a><a href="/demo?role=ap">AP</a><a href="/demo?role=auditor">Auditor</a><a href="/demo?pick=1">All roles</a></nav></div><div class="l3-foot-base"><span>InvoiceOS · Local demo with sample records. Not a production service.</span><a href="/demo?pick=1">Choose a role</a></div></div></footer>
</div>`;
}
const roleCards=[['owner','Owner / Director','Everything across Northstar Studio'],['finance_manager','Finance Manager','AR, AP and approval work'],['ar','AR Accountant','Create invoices and follow up'],['ap','AP Accountant','Review bills and prepare payments'],['approver','Approver','Review bills and invoices'],['buyer_portal','Buyer contact','Open the external buyer portal'],['vendor_portal','Vendor contact','View shared invoice status'],['auditor','Auditor / CA','Read-only review']];
function rolePicker(){return `<div class="role-picker"><div class="picker-brand"><span class="brand-icon">▣</span> invoiceOS<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme" aria-pressed="false" title="Switch to dark theme"><span class="theme-icon sun" aria-hidden="true">☀</span><span class="theme-icon moon" aria-hidden="true">☾</span></button></div><div class="picker-intro"><div class="eyebrow">INTERACTIVE PRODUCT DEMO</div><h1>Choose a point of view.</h1><p>The same invoice looks different to the person who sends it, approves it or pays it.</p></div><div class="role-grid">${roleCards.map(([id,title,desc])=>`<button class="role-card" data-role-pick="${id}"><span class="role-mark">${title[0]}</span><span><b>${title}</b><small>${desc}</small></span><span class="arrow">→</span></button>`).join('')}</div><button class="text-link back-link" data-action="landing">← Back to overview</button></div>`}

function dashboard(){
 const c=queueCounts(),list=invoicesForRole(),bills=billsForRole(),supplier=me().side==='supplier';
 const openDocs=supplier?c.openInv:c.openBills;
 const settled=supplier?list.filter(i=>i.status==='Paid'):bills.filter(b=>b.status==='Paid');
 const pending=c.approvals;
 const disputes=list.filter(i=>i.status==='Dispute');
 const overdue=list.filter(i=>i.status==='Overdue');
 const lateBills=bills.filter(b=>['Paid','Rejected'].includes(b.status)?false:(dueOffset(b.due_date)!==null&&dueOffset(b.due_date)<0));
 const overdueValue=supplier?overdue.reduce((n,i)=>n+Number(i.total||0),0):lateBills.reduce((n,b)=>n+Number(b.amount||0),0);
 const attention=supplier?[...disputes,...overdue,...c.invoicePending]:bills.filter(i=>['Received','Needs approval'].includes(i.status));
 const greeting=({owner:'Arjun',finance_manager:'Meera',ar:'Priya',ap:'Riya',approver:'Kavita',buyer_portal:'Riya',vendor_portal:'Northstar team',auditor:'Audit team'})[role]||'Arjun';
 const tod=new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening';
 const decisionBills=me().side==='buyer'?c.billPending.length:0;
 const recent=[...list].sort((a,b)=>String(b.issue_date).localeCompare(String(a.issue_date))).slice(0,5);
 const primary=supplier&&me().create?btn('+ Create invoice','builder','primary'):btn('+ Add bill','billUpload','primary');
 const secondary=supplier?btn('View receivables','invoices'):btn('Open approvals','approvals','soft');
 const statusCounts=['Sent','Viewed','Pending approval','Overdue'].map(s=>({label:s,count:list.filter(i=>i.status===s).length}));
 const queue=attention.slice(0,5).map(i=>supplier?`<div class="task-row" data-open="${esc(i.id)}"><span class="task-mark">${i.status==='Dispute'?'⚑':i.status==='Overdue'?'!':'✓'}</span><span><b>${esc(i.id)} · ${esc(i.status)}</b><small>${esc(i.dispute_reason||company(i.customer).name)} · ${cash(i.total)}</small></span><span>→</span></div>`:`<div class="task-row" data-page="bills"><span class="task-mark">▣</span><span><b>${esc(i.vendor_invoice_id)} · ${esc(i.status)}</b><small>${esc(company(i.vendor).name)} · ${cash(i.amount)} due ${dateFmt(i.due_date)}</small></span><span>→</span></div>`).join('');
 const openValue=openDocs.reduce((n,d)=>n+Number(supplier?d.total:d.amount),0);
 return `<div class="dashboard-welcome"><div class="welcome-copy"><small>${esc(company(me().org).name.toUpperCase())} · FINANCE WORKSPACE</small><h1>Good ${tod}, ${esc(greeting)}</h1><p>${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${supplier?'Your receivables and partner activity at a glance.':'Your payables and approvals at a glance.'}</p></div><div class="dashboard-actions">${secondary}${primary}</div></div><div class="metrics">${metric(supplier?'Receivables open':'Payables open',cash(openValue),`${openDocs.length} open ${supplier?'invoices':'bills'}`,'↗')}${metric(supplier?'Overdue':'Past due bills',cash(overdueValue),`${supplier?overdue.length:lateBills.length} past due`,'!',overdueValue>0)}${metric(me().approve?'Needs a decision':'In approval',pending,`${c.invoicePending.length} invoice${c.invoicePending.length===1?'':'s'} · ${decisionBills} bill${decisionBills===1?'':'s'}`,'◷',pending>0)}${metric(supplier?'Collected':'Paid',cash(settled.reduce((n,d)=>n+Number(supplier?d.total:d.amount),0)),`${settled.length} marked paid`,'₹')}</div><div class="dashboard-lower"><div><div class="card panel">${panelTitle('Recent invoices',`<button class="text-link" data-action="invoices">View all →</button>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Business</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${invoiceRows(recent)}</tbody></table></div><div class="status-breakdown">${statusCounts.map(x=>`<button type="button" data-status-filter="${x.label}"><b>${x.count}</b><small>${x.label}</small></button>`).join('')}</div></div></div><div class="card panel">${panelTitle(supplier?'Work that needs you':'Bills to review',`<button class="text-link" data-page="${supplier?'disputes':'bills'}">Open queue →</button>`)}<div class="activity">${queue||'<div class="empty">No work is waiting for you.</div>'}</div><div class="shared-object"><b>${state.connections.filter(c=>c.status==='Connected'&&(c.requester===me().org||c.target===me().org)).length} connected businesses</b><small>Invoices and status are shared only with the partners you connect. Open queries stay attached to the invoice.</small></div></div></div>`;
}


function invoiceRows(list,checkable=false,due=false){return list.map(i=>{const other=company(me().side==='supplier'?i.customer:i.supplier);const age=ageLabel(i);return `<tr data-open="${esc(i.id)}" style="cursor:pointer">${checkable?`<td><input type="checkbox" data-select="${esc(i.id)}" aria-label="Select ${esc(i.id)}"></td>`:''}<td class="strong">${esc(i.id)}</td><td>${esc(other.name)}</td><td class="muted">${dateFmt(i.issue_date)}</td>${due?`<td class="due-cell ${age.cls}"><b>${dateFmt(i.due_date)}</b><small>${esc(age.label)}</small></td>`:''}<td class="strong num">${moneyFor(i)}</td><td>${badge(i.status)}</td></tr>`}).join('')||`<tr><td colspan="${(checkable?1:0)+(due?7:6)}" class="empty">No invoices match this view.</td></tr>`}


function invoicesPage(){const list=invoiceSorted(invoiceFiltered());const t=invoiceTotals(list);const quick=[['','All'],['Pending approval','Awaiting approval'],['Overdue','Overdue'],['Dispute','Queries'],['Paid','Paid']];const current=invoiceFilters.status;return `${head('SALES · INVOICES','Invoices','Filter, sort and act on every invoice shared with your business.',me().create?btn('+ Create invoice','builder','primary'):'')}<div class="card panel"><div class="filterbar"><input class="search" id="invoiceSearch" aria-label="Search invoices or businesses" placeholder="⌕  Search invoice or business" value="${esc(invoiceFilters.q)}"><select class="pill" id="invoiceStatus"><option value="">All statuses</option>${['Draft','Sent','Viewed','Pending approval','Approved','Partially paid','Paid','Overdue','Dispute'].map(s=>`<option${current===s?' selected':''}>${s}</option>`).join('')}</select><div class="spacer"></div>${btn('Refresh','refresh')}</div><div class="quick-chips">${quick.map(([v,l])=>`<button type="button" class="quick-chip${current===v?' active':''}" data-quick-status="${esc(v)}">${l}</button>`).join('')}</div><div class="table-wrap"><table class="table invoice-table" id="invoiceTable"><thead><tr><th class="check-col"><input type="checkbox" id="selectAll" aria-label="Select all visible"></th>${sortTh('Invoice','id')}${sortTh('Business','business')}${sortTh('Issued','issue_date')}${sortTh('Due','due_date')}${sortTh('Amount','total','num')}${sortTh('Status','status')}</tr></thead><tbody id="invoiceRows">${invoiceRows(list,true,true)}</tbody></table></div><div class="table-total" id="invoiceTotals"><span><b>${list.length}</b> invoice${list.length===1?'':'s'} in view</span><span>Open value <b>${cash(t.openTotal)}</b></span><span>Total <b>${cash(t.total)}</b></span></div><div class="bulkbar show" id="bulkBar"><span id="selectedCount">0 selected</span><small class="bulk-hint">Tick rows to export, or select all.</small><div class="spacer"></div>${btn('Send reminder','bulk-remind','soft')} ${btn('Export CSV','bulk-export')}</div></div>`}

function detailPage(){const i=state.invoices.find(x=>x.id===selectedId);if(!i)return invoicesPage();const other=company(me().side==='supplier'?i.customer:i.supplier),comments=state.comments.filter(c=>c.invoice_id===i.id),events=state.activity.filter(a=>a.invoice_id===i.id),tax=taxBreakdown(i.supplier_gstin,i.customer_gstin,i.qty*i.rate,i.tax);const actions=[];if(!me().readOnly&&!me().external){if(['Sent','Viewed'].includes(i.status)&&me().side==='buyer'&&role==='ap')actions.push(btn('Submit for approval','status|'+i.id+'|Pending approval','soft'));if(['Sent','Viewed','Pending approval','Resolved'].includes(i.status)&&me().side==='buyer'&&me().approve)actions.push(btn('Approve invoice','status|'+i.id+'|Approved','soft'),...(i.status==='Resolved'?[]:[btn('Reject','status|'+i.id+'|Rejected')]));if(['Approved','Partially paid','Overdue'].includes(i.status)&&me().pay&&isConnected(i.supplier,i.customer,'share_payment_status'))actions.push(btn('Record payment','status|'+i.id+'|Paid'));if(me().side==='buyer'&&!['Dispute','Resolved','Paid','Rejected'].includes(i.status))actions.push(btn('Raise a query','showDispute'))}else if(role==='buyer_portal'&&['Sent','Viewed','Pending approval'].includes(i.status))actions.push(btn('Approve','status|'+i.id+'|Approved','soft'),btn('Ask a question','showDispute'));if(i.status==='Dispute'&&!me().readOnly)actions.push(btn('Resolve query','status|'+i.id+'|Resolved','soft'));return `${head('SHARED INVOICE',esc(i.id),`${esc(other.name)} · Issued ${dateFmt(i.issue_date)} · Due ${dateFmt(i.due_date)}`,btn('← Invoices','invoices'))}<div class="detail-layout"><div><div class="card invoice-hero"><div style="display:flex;justify-content:space-between;align-items:start"><div><div class="invoice-number">${esc(i.id)}</div><p class="subtle">${me().side==='supplier'?'Billed to':'From'} <b>${esc(other.name)}</b></p></div>${badge(i.status)}</div><div class="invoice-meta"><div><label>Issue date</label><strong>${dateFmt(i.issue_date)}</strong></div><div><label>Due date</label><strong>${dateFmt(i.due_date)}</strong></div><div><label>PO reference</label><strong>${esc(i.po_number||'—')}</strong></div></div><div class="amount-box"><span>Total invoice value</span><strong>${moneyFor(i)}</strong></div><div class="invoice-item"><div><b>${esc(i.description)}</b><small>${Number(i.qty)} unit · ${cash(i.rate)} · GST ${Number(i.tax)}%</small></div><div><b>${moneyFor(i)}</b></div></div><div class="tax-split"><span>Taxable value <b>${cash(i.qty*i.rate)}</b></span>${tax.map(t=>`<span>${t.label} <b>${cash(t.value)}</b></span>`).join('')}<span>Total <b>${moneyFor(i)}</b></span></div><div class="shared-object"><b>Shared with ${esc(other.name)}</b><small>Only this invoice and its activity are shared. Other records stay private.</small></div><div class="actions" style="margin-top:16px">${actions.join('')}${btn('Open '+portalLabel().toLowerCase()+' ↗','portal','')}</div><form id="disputeForm" class="field" style="display:none;margin-top:16px"><label>What needs to be resolved?</label><textarea name="reason" required placeholder="Wrong PO, amount, quantity, tax or duplicate"></textarea><button class="btn primary" style="margin-top:8px">Send query</button></form></div><div class="card panel" style="margin-top:15px">${panelTitle('Shared conversation')}<div>${comments.map(c=>`<div class="activity-item"><div class="activity-copy"><b>${esc(company(c.actor).name)}</b><small>${dateFmt(c.created_at)}</small><div>${esc(c.body)}</div></div></div>`).join('')||'<p class="subtle">No replies yet.</p>'}</div>${!me().readOnly?`<form id="commentForm" class="field"><label>Reply</label><textarea name="body" required placeholder="Add a reply to this shared invoice"></textarea><button class="btn soft" style="margin-top:8px">Send reply</button></form>`:''}</div></div><div class="card timeline"><h2>Status timeline</h2>${events.map(a=>`<div class="timeline-item"><div class="dot">✓</div><div class="timeline-copy"><b>${esc(a.action)}</b><small>${dateFmt(a.created_at)} · ${esc(company(a.actor).name)}</small>${a.detail?`<small>${esc(a.detail)}</small>`:''}</div></div>`).join('')}<div class="timeline-item"><div class="dot">◎</div><div class="timeline-copy"><b>Shared object</b><small>Both companies see the same invoice status and conversation.</small></div></div></div></div>`}
function taxBreakdown(sgstin,bgstin,taxable,rate){const amount=Number(taxable)*Number(rate)/100;const intra=String(sgstin||'').slice(0,2)===String(bgstin||'').slice(0,2);return intra?[{label:`CGST (${rate/2}%)`,value:amount/2},{label:`SGST (${rate/2}%)`,value:amount/2}]:[{label:`IGST (${rate}%)`,value:amount}]}
function builder(){const counterparties=state.businesses.filter(b=>b.id!==me().org&&isConnected(me().org,b.id));const today=new Date(),due=new Date();due.setDate(today.getDate()+30);return `${head('SALES · NEW INVOICE','Create invoice','Add a service line and review the GST split before sharing.',btn('← Cancel','invoices'))}<div class="builder-grid"><div class="card panel"><form id="invoiceForm"><div class="form-grid"><div class="field"><label>Customer *</label><select name="customer" required><option value="">Choose a connected business</option>${counterparties.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div><div class="field"><label>Invoice number *</label><input name="id" required value="INV-${today.getFullYear()}-${String(state.invoices.length+901).padStart(4,'0')}"></div><div class="field"><label>Issue date *</label><input name="issue_date" type="date" required value="${today.toISOString().slice(0,10)}"></div><div class="field"><label>Due date *</label><input name="due_date" type="date" required value="${due.toISOString().slice(0,10)}"></div><div class="field"><label>Purchase order</label><input name="po_number" placeholder="Buyer reference"></div><div class="field"><label>GST rate</label><select name="tax"><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18" selected>18%</option><option value="28">28%</option></select></div><div class="field full"><label>Service description *</label><input name="description" required placeholder="e.g. Brand identity and campaign design"></div><div class="field"><label>Quantity *</label><input name="qty" type="number" min="0.01" step="0.01" value="1" required></div><div class="field"><label>Rate per unit (₹) *</label><input name="rate" type="number" min="0" step="0.01" value="100000" required></div></div><div class="tax-preview" id="invoiceTotal"></div><div class="field"><label>Tax calculation</label><small class="subtle">GST split is estimated from the GSTIN state codes in this demo. Review with your CA before use.</small></div><div style="display:flex;justify-content:flex-end;margin-top:20px"><button type="button" class="btn primary" data-action="submit-invoice">Save and share invoice →</button></div></form></div><aside class="card panel builder-aside"><div class="eyebrow">LIVE PREVIEW</div><h2>Shared invoice</h2><p class="subtle">Your buyer receives a structured invoice in their bill inbox. They can view, query, approve and record payment.</p><div class="shared-object"><b>Invoice number</b><small>Assigned from this demo series</small></div><p class="subtle" style="margin-top:18px">Demo records use sample details and aren’t valid tax invoices.</p></aside></div>`}

function billRows(list){return list.map(b=>{const age=ageLabel({status:'',due_date:b.due_date});let action='—';if(b.status==='Needs approval'&&me().approve&&me().side==='buyer')action=`<button class="text-link" data-bill-status="${esc(b.id)}|Approved">Approve</button> · <button class="text-link" data-bill-status="${esc(b.id)}|Rejected">Reject</button>`;else if(b.status==='Received'&&!me().readOnly&&me().side==='buyer')action=`<button class="text-link" data-bill-status="${esc(b.id)}|Needs approval">Submit for approval</button>`;else if(b.status==='Approved'&&role==='ap')action=`<button class="text-link" data-bill-status="${esc(b.id)}|Scheduled">Schedule payment</button>`;else if(b.status==='Scheduled'&&role==='ap')action=`<button class="text-link" data-bill-status="${esc(b.id)}|Paid">Record paid</button>`;else if(b.status==='Needs approval'&&me().side!=='buyer')action='<span class="subtle">With the buyer</span>';return `<tr class="${age.cls==='late'?'row-late':''}"><td class="strong">${esc(b.id)}</td><td>${esc(company(b.vendor).name)}</td><td>${esc(b.vendor_invoice_id)}</td><td>${esc(b.description)}</td><td class="due-cell ${age.cls}"><b>${dateFmt(b.due_date)}</b><small>${esc(age.label)}</small></td><td class="strong num">${cash(b.amount)}</td><td>${badge(b.status)}</td><td>${action}</td></tr>`}).join('')||'<tr><td colspan="8" class="empty">No bills in this inbox.</td></tr>'}


function billFiltered(){const q=($('#billSearch')?.value||'').toLowerCase(),st=$('#billStatus')?.value||'';return billsForRole().filter(b=>(!st||b.status===st)&&(`${b.id} ${b.vendor_invoice_id} ${company(b.vendor).name}`).toLowerCase().includes(q))}
function renderBillTable(){
 const list=billFiltered();
 const body=$('#billRows');if(!body)return;
 body.innerHTML=billRows(list);
 const open=list.filter(b=>!['Paid','Rejected'].includes(b.status));
 const el=$('#billTotals');
 if(el)el.innerHTML=`<span><b>${list.length}</b> bill${list.length===1?'':'s'} in view</span><span>Needs approval <b>${list.filter(b=>b.status==='Needs approval').length}</b></span><span>Open value <b>${cash(open.reduce((n,b)=>n+Number(b.amount||0),0))}</b></span>`;
}
function billsPage(){const list=billsForRole();const open=list.filter(b=>!['Paid','Rejected'].includes(b.status));const late=open.filter(b=>dueOffset(b.due_date)!==null&&dueOffset(b.due_date)<0);return `${head('PURCHASES · AP INBOX','Bills inbox','Capture supplier bills, check extracted fields and move them into approvals.',me().side==='buyer'?btn('+ Add bill','billUpload','primary'):'')}<div class="metrics">${metric('Bills received',list.length,'In this workspace','▤')}${metric('Needs approval',list.filter(b=>b.status==='Needs approval').length,me().side==='buyer'?'Human review required':'Waiting on the buyer','✓',list.some(b=>b.status==='Needs approval'))}${metric('Past due',late.length,'Open bills past their due date','!',late.length>0)}${metric('Open bill value',cash(open.reduce((n,b)=>n+Number(b.amount||0),0)),'Before payment','₹')}</div><div class="card panel">${panelTitle('Bill inbox',`<span class="subtle">${list.length} records</span>`)}<div class="filterbar"><input class="search" id="billSearch" aria-label="Search vendor or bill" placeholder="⌕ Search vendor or bill"><select class="pill" id="billStatus"><option value="">All statuses</option><option>Received</option><option>Needs approval</option><option>Approved</option><option>Scheduled</option><option>Paid</option><option>Rejected</option></select></div><div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Vendor</th><th>Vendor invoice</th><th>Description</th><th>Due</th><th class="num">Amount</th><th>Status</th><th>Action</th></tr></thead><tbody id="billRows">${billRows(list)}</tbody></table></div><div class="table-total" id="billTotals"><span><b>${list.length}</b> bills in view</span><span>Needs approval <b>${list.filter(b=>b.status==='Needs approval').length}</b></span><span>Open value <b>${cash(open.reduce((n,b)=>n+Number(b.amount||0),0))}</b></span></div></div><div class="shared-object"><b>Bills stay with the buyer’s AP team</b><small>Supplier-side users can see bills shared with them but cannot approve or schedule the buyer’s payables. Those actions belong to the buyer’s approver and AP accountant.</small></div>`}

function billUpload(){return `${head('PURCHASES · AP INBOX','Capture a bill','Review the extracted fields. Nothing is posted without your confirmation.',btn('← Bills inbox','bills'))}<div class="builder-grid"><div class="card panel"><form id="billForm"><div class="field"><label>Invoice file</label><input type="file" name="file" accept="application/pdf,image/*"><small class="subtle">Sample mode: no file is uploaded. Use “Fill sample extraction” to preview the workflow.</small></div><button type="button" class="btn soft" data-action="sample-ocr" style="margin:14px 0">✦ Fill sample extraction</button><div class="form-grid"><div class="field"><label>Vendor</label><select name="vendor" required><option value="">Choose vendor</option>${state.businesses.filter(b=>b.id!==me().org&&isConnected(me().org,b.id)).map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div><div class="field"><label>Vendor invoice number</label><input name="vendor_invoice_id" required></div><div class="field"><label>Due date</label><input name="due_date" type="date" required value="${new Date(Date.now()+30*864e5).toISOString().slice(0,10)}"></div><div class="field"><label>Amount including tax (₹)</label><input name="amount" type="number" step="0.01" min="0.01" required></div><div class="field"><label>PO reference</label><input name="po_number"></div><div class="field"><label>Extraction confidence</label><input name="confidence" value="Awaiting review" readonly></div><div class="field full"><label>Description</label><input name="description" required></div></div><div style="display:flex;justify-content:flex-end;margin-top:18px"><button class="btn primary">Save bill to inbox</button></div></form></div><aside class="card panel"><div class="eyebrow">HUMAN REVIEW</div><h2>Check before posting</h2><p class="subtle">OCR here is a visual demo only. The extracted values are suggestions; a person reviews every field before the bill is saved.</p><div class="shared-object"><b>Duplicate check</b><small>Vendor + invoice number + amount</small></div></aside></div>`}

function connectionsPage(){
 const conns=state.connections.filter(c=>c.requester===me().org||c.target===me().org);
 const connected=conns.filter(c=>c.status==='Connected'),pending=conns.filter(c=>c.status==='Pending');
 const scopeLabels={exchange_invoices:'Exchange invoices',share_payment_status:'Share payment status'};
 const cardFor=c=>{
  const other=c.requester===me().org?company(c.target):company(c.requester);
  let scopes=[];try{scopes=JSON.parse(c.scopes||'[]')}catch{}
  const pair=state.invoices.filter(i=>(i.supplier===me().org&&i.customer===other.id)||(i.customer===me().org&&i.supplier===other.id));
  const openPair=pair.filter(i=>!['Draft','Paid','Rejected','Resolved'].includes(i.status));
  const openValue=openPair.reduce((n,i)=>n+Number(i.total||0),0);
  const queries=pair.filter(i=>i.status==='Dispute').length;
  const dir=c.requester===me().org?'You invited them':`${esc(company(c.requester).name)} invited you`;
  let action='';
  if(c.status==='Pending'&&c.target===me().org&&!me().readOnly)action=`<button class="btn small soft" data-connection="${esc(c.id)}|Connected">Accept</button><button class="btn small" data-connection="${esc(c.id)}|Declined">Decline</button>`;
  else if(c.status==='Pending'&&c.requester===me().org&&!me().readOnly)action=`<button class="btn small" data-connection="${esc(c.id)}|Connected">Preview partner acceptance</button>`;
  else if(c.status==='Connected'&&!me().readOnly)action=`<button class="text-link danger-link" data-connection="${esc(c.id)}|Revoked">Revoke access</button>`;
  const scopeChips=['exchange_invoices','share_payment_status'].map(s=>`<span class="scope-chip ${scopes.includes(s)?'on':'off'}">${scopes.includes(s)?'✓':'◦'} ${scopeLabels[s]}</span>`).join('');
  return `<article class="card connection-card ${c.status.toLowerCase()}"><header><span class="co-logo">${esc(other.name[0]||'B')}</span><div class="co-copy"><h3>${esc(other.name)}</h3><small>${dir} · ${dateFmt(c.created_at)}</small></div>${badge(c.status)}</header><div class="scope-pills">${scopeChips}</div><div class="connection-stats"><div><b>${pair.length}</b><small>shared invoices</small></div><div><b>${cash(openValue)}</b><small>open value</small></div><div><b>${queries}</b><small>open queries</small></div></div><footer>${action||'<span class="subtle">No action needed</span>'}</footer></article>`;
 };
 return `${head('NETWORK · CONNECTIONS','Connected businesses','Invite a trading partner and choose exactly what your companies share.',me().readOnly?'':btn('+ Invite business','invite','primary'))}<div class="metrics">${metric('Connected',connected.length,'Active trading links','◎')}${metric('Pending',pending.length,'Waiting for acceptance','◷',pending.length>0)}${metric('Invoices shared',state.invoices.filter(i=>(i.supplier===me().org||i.customer===me().org)).length,'Across all connections','▤')}${metric('Scopes in use',new Set(conns.flatMap(c=>{try{return JSON.parse(c.scopes||'[]')}catch{return[]}})).size,'What partners can see','⌁')}</div><div class="card panel">${panelTitle('Connection requests and active links',`<span class="subtle">${conns.length} total</span>`)}<form id="connectionForm" class="connection-form" hidden><div><b>Invite a business</b><small>This local demo does not send email. A new request stays pending until you preview partner acceptance.</small></div><div class="connection-fields"><label>Business name<input name="name" required maxlength="120" placeholder="e.g. Kaveri Components"></label><label>Business email<input name="email" type="email" placeholder="finance@example.in"></label><label>GSTIN (optional)<input name="gstin" maxlength="15" placeholder="15-character GSTIN"></label></div><div class="connection-scopes"><label><input type="checkbox" name="scopes" value="exchange_invoices" checked> Exchange invoices</label><label><input type="checkbox" name="scopes" value="share_payment_status" checked> Share payment status</label></div><div class="actions"><button type="button" class="btn" data-action="cancel-invite">Cancel</button><button class="btn primary">Send connection request</button></div></form><div class="connection-grid">${conns.map(cardFor).join('')||'<div class="empty">No connection requests yet.</div>'}</div></div>${bizPartnerPanel()}<div class="card panel" style="margin-top:15px">${panelTitle('Sharing stays scoped')}<p class="subtle">Connected businesses see only documents you explicitly share. They can’t see your other customers, vendor list, margins or ledger.</p><div class="scope-pills"><span class="scope-chip on">✓ Exchange invoices</span><span class="scope-chip on">✓ Share payment status</span><span class="scope-chip off">◦ Share statements (off)</span><span class="scope-chip off">◦ Share catalog (off)</span></div></div>`;
}


function approvalsPage(){
 const c=queueCounts(),inv=c.invoicePending;
 const canBill=me().side==='buyer';
 const bill=canBill?c.billPending:[];
 const withBuyer=canBill?[]:c.billPending;
 const invValue=inv.reduce((n,i)=>n+Number(i.total||0),0),billValue=bill.reduce((n,b)=>n+Number(b.amount||0),0),waitingValue=withBuyer.reduce((n,b)=>n+Number(b.amount||0),0);
 const total=inv.length+bill.length;
 const recent=[
  ...state.invoices.filter(i=>['Approved','Rejected'].includes(i.status)).map(i=>({type:'Invoice',id:i.id,party:company(me().side==='supplier'?i.customer:i.supplier).name,amount:Number(i.total||0),status:i.status,at:i.updated_at})),
  ...state.bills.filter(b=>['Approved','Rejected'].includes(b.status)).map(b=>({type:'Bill',id:b.id,party:company(b.vendor).name,amount:Number(b.amount||0),status:b.status,at:b.created_at}))
 ].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,6);
 const bulk=me().approve&&total?`<button class="btn primary" data-action="approve-all">✓ Approve all ${total}</button>`:'';
 const invRows=inv.map(i=>{const age=ageLabel(i);return `<tr data-open="${esc(i.id)}"><td class="strong">${esc(i.id)}<small class="row-note">${esc(i.description||'Shared invoice')}</small></td><td>${esc(company(me().side==='supplier'?i.customer:i.supplier).name)}</td><td>${esc(i.po_number||'—')}</td><td class="strong num">${moneyFor(i)}</td><td><b class="${age.cls}">${esc(age.label)}</b><small class="row-note">Due ${dateFmt(i.due_date)}</small></td><td class="muted">${dateFmt(i.updated_at)}</td><td class="decision-cell">${me().approve?`<button class="btn small soft" data-status="${esc(i.id)}|Approved">Approve</button> <button class="btn small" data-status="${esc(i.id)}|Rejected">Reject</button>`:'Waiting for approver'}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No invoices awaiting approval.</td></tr>';
 const billRows= bill.map(b=>{const age=ageLabel({status:'',due_date:b.due_date});return `<tr data-page="bills"><td class="strong">${esc(b.id)}<small class="row-note">${esc(b.description||'Supplier bill')}</small></td><td>${esc(company(b.vendor).name)}</td><td>${esc(b.vendor_invoice_id)}</td><td class="strong num">${cash(b.amount)}</td><td><b class="${age.cls}">${esc(age.label)}</b><small class="row-note">Due ${dateFmt(b.due_date)}</small></td><td class="muted">${dateFmt(b.created_at)}</td><td class="decision-cell">${me().approve?`<button class="btn small soft" data-bill-status="${esc(b.id)}|Approved">Approve</button> <button class="btn small" data-bill-status="${esc(b.id)}|Rejected">Reject</button>`:'Waiting for approver'}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No bills awaiting approval.</td></tr>';
 const waitingRows=withBuyer.map(b=>{const age=ageLabel({status:'',due_date:b.due_date});return `<tr data-page="bills"><td class="strong">${esc(b.id)}<small class="row-note">${esc(b.description||'Supplier bill')}</small></td><td>${esc(company(b.vendor).name)}</td><td class="strong num">${cash(b.amount)}</td><td><b class="${age.cls}">${esc(age.label)}</b><small class="row-note">Due ${dateFmt(b.due_date)}</small></td><td class="muted">${esc(b.status)} · buyer decision</td></tr>`}).join('');
 const recentRows=recent.map(r=>`<tr><td class="strong">${esc(r.type)} ${esc(r.id)}</td><td>${esc(r.party)}</td><td class="num">${cash(r.amount)}</td><td>${badge(r.status)}</td><td class="muted">${dateFmt(r.at)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No decisions recorded yet.</td></tr>';
 const waitingPanel=withBuyer.length?`<div class="card panel" style="margin-top:15px">${panelTitle('Bills with the buyer',`<span class="subtle">${withBuyer.length} shared · buyer records the decision</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Vendor</th><th>Amount</th><th>Ageing</th><th>Status</th></tr></thead><tbody>${waitingRows}</tbody></table></div></div>`:'';
 return `${head('WORKFLOW · APPROVALS','Approval queue',total?'Every record waiting for a human decision, with the context to decide.':'Nothing is waiting for this role right now. Shared records stay visible below.',bulk)}<div class="metrics">${metric('Awaiting your decision',total,'Records this role can decide','◷',total>0)}${metric('Invoice value',cash(invValue),`${inv.length} invoice${inv.length===1?'':'s'}`,'▤')}${metric('Bill value',cash(billValue+waitingValue),canBill?`${bill.length} bill${bill.length===1?'':'s'}`:`${withBuyer.length} shared with buyer`,'▣')}${metric('Approver',me().approve?'You can decide':'View only in this role','Role permission','✓')}</div>${total?`<div class="card panel">${panelTitle('Invoices awaiting your decision',`<span class="subtle">${inv.length} item${inv.length===1?'':'s'} · ${cash(invValue)}</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Business</th><th>PO</th><th>Amount</th><th>Ageing</th><th>Submitted</th><th>Decision</th></tr></thead><tbody>${invRows}</tbody></table></div></div><div class="card panel" style="margin-top:15px">${panelTitle('Bills awaiting your decision',`<span class="subtle">${bill.length} item${bill.length===1?'':'s'} · ${cash(billValue)}</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Vendor</th><th>Reference</th><th>Amount</th><th>Ageing</th><th>Received</th><th>Decision</th></tr></thead><tbody>${billRows}</tbody></table></div></div>`:`<div class="card panel queue-clear"><span class="queue-clear-icon">✓</span><div><h2>Queue is clear</h2><p class="subtle">No invoice or supplier bill is waiting for this role to decide. New submissions appear here as soon as a partner sends them.</p></div></div>`}${waitingPanel}<div class="card panel" style="margin-top:15px">${panelTitle('Recent decisions','<span class="subtle">Status changes already recorded</span>')}<div class="table-wrap"><table class="table"><thead><tr><th>Record</th><th>Business</th><th>Amount</th><th>Decision</th><th>Date</th></tr></thead><tbody>${recentRows}</tbody></table></div></div><div class="shared-object"><b>Every decision is a person’s call</b><small>The demo records the business account that approved or rejected a record. Supplier-side users can see a buyer’s bill but cannot decide it. “Approve all” only acts on the items currently waiting for this role.</small></div>`;
}


function disputesPage(){
 const list=invoicesForRole().filter(i=>['Dispute','Resolved'].includes(i.status));
 const open=list.filter(i=>i.status==='Dispute'),resolved=list.filter(i=>i.status==='Resolved');
 const value=open.reduce((n,i)=>n+Number(i.total||0),0);
 const days=s=>{const t=new Date(s).getTime();return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/86400000)):0};
 const oldest=open.length?Math.max(...open.map(i=>days(i.updated_at))):0;
 const rows=list.map(i=>{const age=ageLabel(i);const held=days(i.updated_at);return `<tr data-open="${esc(i.id)}"><td class="strong">${esc(i.id)}</td><td>${esc(company(me().side==='supplier'?i.customer:i.supplier).name)}</td><td>${esc(i.dispute_reason||'No reason recorded')}</td><td><b class="${i.status==='Dispute'?'late':''}">${i.status==='Dispute'?`${held}d open`:`Resolved`}</b><small class="row-note">Due ${dateFmt(i.due_date)}</small></td><td class="strong num">${moneyFor(i)}</td><td>${badge(i.status)}</td></tr>`}).join('')||'<tr><td colspan="6" class="empty">No open queries.</td></tr>';
 const steps=[['1','Raise','Either business opens a question on the shared invoice record.'],['2','Discuss','Both sides reply in the same thread. Reminders pause while it is open.'],['3','Resolve','A person records the outcome and the invoice returns to the shared flow.']];
 return `${head('NETWORK · DISPUTES','Shared queries','Open a thread to review and resolve an invoice question.')}<div class="metrics">${metric('Open queries',open.length,'Invoices with an open question','⚑',open.length>0)}${metric('Query value',cash(value),'Open invoice value','₹')}${metric('Oldest query',oldest?`${oldest}d`:'—','Days since the last update','⌛',oldest>7)}${metric('Resolved',resolved.length,'Closed queries in this view','✓')}</div><div class="card panel">${panelTitle('Invoice queries',`<span class="subtle">${list.length} record${list.length===1?'':'s'}</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Business</th><th>Reason</th><th>Query age</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div><div class="query-steps">${steps.map(([n,t,d])=>`<article class="card query-step"><b>${n}</b><div><h3>${t}</h3><p>${d}</p></div></article>`).join('')}</div><div class="shared-object"><b>Reminders paused while a query is open</b><small>Demo behavior: disputed invoices are excluded from the reminder queue. Nothing here sends an email or moves money.</small></div>`;
}

function morePage(){const links=[['approvals','✓','Approvals','Invoices and bills waiting for review'],['disputes','⚑','Disputes','Shared invoice questions'],['payments','₹','Payment status','Settlement updates on invoices'],['team','♙','Team workload','Queue volume and role-level workload'],['calendar','▦','Calendar','Meetings, assigned work and deadlines'],['activity','◷','Activity trail','Recent events on visible invoices'],['insights','⌁','Flow insights','Due-date, approval and exception indicators'],['portal','↗',portalLabel(),'Open the external invoice view'],['connections','◎','Connections','Manage trading partners'],...bizMoreLinks()].filter(([key])=>{if(bizHiddenPages().has(key))return false;if(me().external)return key==='portal';if(role==='ar')return !['approvals'].includes(key);if(role==='approver')return !['connections','payments'].includes(key);return true});return `${head('WORKSPACE · MORE','More workspace tools','Open another part of your finance workspace.')}<div class="more-grid">${links.map(([key,icon,title,desc])=>`<button class="btn more-link" data-page="${key}"><span>${icon}</span><span><b>${title}</b><small>${desc}</small></span><span class="more-arrow">→</span></button>`).join('')}<button class="btn more-link" data-action="roles"><span>⇄</span><span><b>Switch demo role</b><small>See the workspace from another perspective</small></span><span class="more-arrow">→</span></button></div><div class="more-lower"><section class="card panel">${panelTitle('Your current view')}<div class="more-facts"><div><small>Signed in as</small><b>${esc(me().label)}</b></div><div><small>Business</small><b>${esc(company(me().org).name)}</b></div><div><small>Can create invoices</small><b>${me().create?'Yes':'No'}</b></div><div><small>Can record approvals</small><b>${me().approve?'Yes':'No'}</b></div></div><p class="subtle">Role changes affect which records and actions appear. They do not change the underlying demo data.</p></section><section class="card panel">${panelTitle('Demo boundaries')}<ul class="boundary-list"><li>No AI layer. Every status change is a recorded human action.</li><li>No money moves. Payment status is a label on the shared record.</li><li>No email is sent. Invites and reminders are simulated locally.</li><li>Data stays in a local SQLite file on this machine.</li></ul></section></div>`}
function paymentsPage(){const list=invoicesForRole().filter(i=>['Approved','Partially paid','Paid','Overdue'].includes(i.status));return `${head('MONEY · PAYMENT STATUS','Payment status','See settlement status recorded on shared invoices. This demo does not move money.',btn('View invoices','invoices'))}<div class="metrics">${metric('Settled',list.filter(i=>i.status==='Paid').length,'Invoices marked paid','✓')}${metric('Partially paid',list.filter(i=>i.status==='Partially paid').length,'Balance still open','◐')}${metric('Awaiting payment',list.filter(i=>['Approved','Overdue'].includes(i.status)).length,'Approved or overdue','₹')}${metric('Open queries',invoicesForRole().filter(i=>i.status==='Dispute').length,'Reminders pause on disputes','⚑')}</div><div class="card panel">${panelTitle('Invoice settlement status')}<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Business</th><th>Due date</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${list.map(i=>`<tr><td class="strong" data-open="${esc(i.id)}">${esc(i.id)}</td><td>${esc(company(me().side==='supplier'?i.customer:i.supplier).name)}</td><td>${dateFmt(i.due_date)}</td><td>${moneyFor(i)}</td><td>${badge(i.status)}</td><td>${me().pay&&i.status!=='Paid'?`<button class="text-link" data-status="${esc(i.id)}|Paid">Record paid</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No payment statuses to show.</td></tr>'}</tbody></table></div><p class="subtle">“Record paid” updates the demo invoice status and timeline. It does not initiate a bank or payment-provider transaction.</p></div>`}
function portalPage(){const list=invoicesForRole(),label=portalLabel(),buyer=me().side==='buyer';return `<div class="portal-shell"><div class="portal-brand"><div class="brand"><span class="brand-icon">▣</span>invoice<span style="color:var(--green);margin-left:-9px">OS</span></div><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme" aria-pressed="false" title="Switch to dark theme"><span class="theme-icon sun" aria-hidden="true">☀</span><span class="theme-icon moon" aria-hidden="true">☾</span></button><span>SECURE ${label.toUpperCase()} · DEMO</span></div><div class="portal-welcome"><div class="eyebrow">${esc(company(me().org).name.toUpperCase())}</div><h1>${buyer?'Invoices shared with you,':'Invoices you shared,'}<br>in one place.</h1><p>View an invoice, ask a question or record its status. This demo portal has no sign-in or real payment.</p></div><div class="card panel portal-card">${panelTitle(buyer?'Invoices shared with your business':'Invoices shared with buyers')}<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>${buyer?'Supplier':'Buyer'}</th><th>Issued</th><th>Amount</th><th>Status</th></tr></thead><tbody>${invoiceRows(list)}</tbody></table></div></div><button class="text-link" data-action="roles">← Switch demo role</button></div>`}
function dueOffset(value){if(!value)return null;const d=new Date(`${String(value).slice(0,10)}T00:00:00`);if(Number.isNaN(d.getTime()))return null;const t=new Date();t.setHours(0,0,0,0);return Math.floor((d.getTime()-t.getTime())/86400000)}
function visibleActivity(){const invoiceIds=new Set(invoicesForRole().map(i=>i.id)),billIds=new Set(billsForRole().map(b=>b.id));const invoices=state.activity.filter(a=>invoiceIds.has(a.invoice_id)).map(a=>({...a,record_type:'Invoice',record_id:a.invoice_id}));const bills=(state.bill_activity||[]).filter(a=>billIds.has(a.bill_id)).map(a=>({...a,record_type:'Bill',record_id:a.bill_id}));return [...invoices,...bills].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,80)}
function roleVisibleRecords(){
 const invoices=invoicesForRole(),bills=billsForRole();
 const mirroredIds=new Set(bills.map(b=>b.vendor_invoice_id));
 const invoiceIds=new Set(invoices.map(i=>i.id));
 const invoiceRows=invoices.filter(i=>me().side!=='buyer'||!mirroredIds.has(i.id)).map(i=>({type:'invoice',id:i.id,status:i.status,due:i.due_date,amount:Number(i.total||0),party:company(me().side==='supplier'?i.customer:i.supplier).name}));
 const billRows=bills.filter(b=>me().side!=='supplier'||!invoiceIds.has(b.vendor_invoice_id)).map(b=>({type:'bill',id:b.id,status:b.status,due:b.due_date,amount:Number(b.amount||0),party:company(me().side==='buyer'?b.vendor:b.buyer).name}));
 return [...invoiceRows,...billRows];
}
function teamPage(){
 const invoices=invoicesForRole(),bills=billsForRole(),records=roleVisibleRecords();
 const openInvoices=invoices.filter(i=>!['Draft','Paid','Rejected','Resolved'].includes(i.status));
 const openBills=bills.filter(b=>!['Paid','Rejected'].includes(b.status));
 const active=records.filter(r=>!['Draft','Paid','Rejected','Resolved'].includes(r.status));
 const decisions=records.filter(r=>r.status==='Pending approval'||(r.type==='bill'&&me().side==='buyer'&&r.status==='Needs approval'));
 const exceptions=records.filter(r=>['Overdue','Dispute'].includes(r.status)||dueOffset(r.due)<0);
 const dueSoon=active.filter(r=>dueOffset(r.due)!==null&&dueOffset(r.due)>=0&&dueOffset(r.due)<=7).length;
 const queues=[
  ['↗','Invoice flow','Invoices still moving through the shared process',openInvoices.map(i=>({type:'invoice',id:i.id,status:i.status,due:i.due_date,amount:Number(i.total||0),party:company(me().side==='supplier'?i.customer:i.supplier).name}))],
  ['▣',me().side==='buyer'?'Payables':'Shared bills',me().side==='buyer'?'Bills waiting for review or settlement':'Supplier-side visibility into bills shared with us',openBills.map(b=>({type:'bill',id:b.id,status:b.status,due:b.due_date,amount:Number(b.amount||0),party:company(me().side==='buyer'?b.vendor:b.buyer).name}))],
  ['✓','Decision queue','Items currently marked as awaiting approval',decisions],
  ['⚑','Exceptions','Overdue invoices, disputes and past-due bills',exceptions]
 ];
 const max=Math.max(1,...queues.map(q=>q[3].length));
 const people=[
  ['owner','Arjun Kulkarni','Owner / Director','Everything across the business'],
  ['finance_manager','Meera Nair','Finance Manager','AR, AP and approvals'],
  ['ar','Priya Shah','AR Accountant','Invoices and follow-ups'],
  ['ap','Riya Menon','AP Accountant','Bills and payment prep'],
  ['approver','Kavita Rao','Approver','Invoice and bill decisions'],
  ['buyer_portal','Sameer Joshi','Buyer contact','Meridian buyer portal'],
  ['vendor_portal','Nikhil Verma','Vendor contact','Shared invoice status'],
  ['auditor','Ananya Iyer','Auditor / CA','Read-only review']
 ];
 const roster=people.map(([id,name,roleLabel,focus])=>{
  const initials=name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `<button type="button" class="person-card${role===id?' is-me':''}" data-team-role="${id}" aria-pressed="${role===id}"><span class="person-avatar">${initials}</span><span class="person-meta"><b>${esc(name)}</b><small>${esc(roleLabel)}</small><em>${esc(focus)}</em></span>${role===id?'<span class="person-flag">Viewing</span>':''}</button>`;
 }).join('');
 const cards=queues.map(([icon,title,desc,items])=>`<article class="card workload-card"><div class="workload-head"><span class="workload-icon">${icon}</span><div><small>WORK QUEUE</small><h2>${title}</h2></div><b>${items.length}</b></div><p>${desc}</p><div class="workload-track"><i style="--fill:${Math.max(items.length?9:0,Math.round(items.length/max*100))}%"></i></div><div class="workload-list">${items.slice(0,3).map(i=>`<button class="workload-item" ${i.type==='invoice'?`data-open="${esc(i.id)}"`:'data-page="bills"'}><span><b>${esc(i.id)} · ${esc(i.status)}</b><small>${esc(i.party)} · due ${dateFmt(i.due)}</small></span><strong>${cash(i.amount)}</strong></button>`).join('')||'<div class="empty">Nothing waiting in this queue.</div>'}</div>${items.length>3?`<button class="text-link workload-more" data-page="${title==='Invoice flow'?'invoices':'bills'}">View ${items.length-3} more →</button>`:''}</article>`).join('');
 return `${head('PEOPLE & WORK','Team workload','See the people behind each role and where work is building up in their queues.')}<div class="metrics">${metric('Active records',active.length,'Unique open records','◷')}${metric('Needs a decision',decisions.length,'Pending approval','✓',decisions.length>0)}${metric('Due in 7 days',dueSoon,'Open records approaching due date','⌁',dueSoon>0)}${metric('Exceptions',exceptions.length,'Past due or in dispute','⚑',exceptions.length>0)}</div><section class="card panel people-board"><div class="panel-head"><h2>People in this workspace</h2><span class="honest-chip">Sample team</span></div><div class="people-strip">${roster}</div><p class="people-note">Pick a person to view the queues their role can see. Names are demo personas; no attendance, assignments or productivity scores are recorded.</p></section><div class="workload-grid">${cards}</div><div class="shared-object team-note"><b>Role-level visibility</b><small>Counts and record age come from this workspace’s demo records. Individual staff assignments and personal performance scores are not captured here.</small><button class="text-link" data-page="activity">See the activity trail →</button></div>`;
}

function activityPage(){
 const events=visibleActivity();
 const merged=[];const seen=new Map();
 for(const a of events){
  const key=[a.record_type,a.record_id,a.action,a.detail,a.actor].join('|');
  const prev=seen.get(key);const t=new Date(a.created_at).getTime();
  if(prev&&Number.isFinite(t)&&Number.isFinite(prev.time)&&Math.abs(prev.time-t)<20*60*1000){prev.repeat+=1;continue}
  const item={...a,repeat:1,time:t};seen.set(key,item);merged.push(item);
 }
 const groups=new Map();
 merged.forEach(a=>{const day=String(a.created_at||'').slice(0,10)||'Unknown';if(!groups.has(day))groups.set(day,[]);groups.get(day).push(a)});
 const body=[...groups.entries()].map(([day,items])=>{
  const dt=day==='Unknown'?null:new Date(day+'T00:00:00');
  const heading=dt&&!isNaN(dt)?dt.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'Undated events';
  return `<section class="event-day"><div class="event-day-head"><span>${esc(heading)}</span><b>${items.length} event${items.length===1?'':'s'}</b></div>${items.map(a=>{
   const action=String(a.action||'').toLowerCase();
   const kind=action.includes('comment')||action.includes('reply')?'discussion':action.includes('created')||action.includes('sent')||action.includes('received')||action.includes('available in ap')?'created':'status';
   const icon=kind==='discussion'?'↳':kind==='created'?'＋':'✓';
   const attrs=a.record_type==='Invoice'?`data-open="${esc(a.record_id)}"`:'data-page="bills"';
   return `<article class="activity-record" data-activity-kind="${kind}" ${attrs}><span class="event-icon event-${kind}">${icon}</span><div class="event-body"><div class="event-top"><b>${esc(a.action)}${a.repeat>1?` <em class="repeat-badge">×${a.repeat}</em>`:''}</b><time>${new Date(a.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</time></div><p>${esc(a.record_type)} ${esc(a.record_id)} · ${esc(company(a.actor).name)}</p><small>${esc(a.detail||'Shared record updated')}</small></div><span class="event-go">→</span></article>`}).join('')}</section>`;
 }).join('');
 return `${head('PEOPLE & WORK · ACTIVITY','Activity trail','Recent changes on invoices and bills visible to the selected role, grouped by day.')}<div class="card panel activity-panel"><div class="activity-toolbar"><span class="subtle">${merged.length} events · ${events.length-merged.length} repeated updates merged</span><select id="activityFilter" aria-label="Filter activity"><option value="all">All activity</option><option value="status">Status changes</option><option value="created">Created or received</option><option value="discussion">Comments and replies</option></select></div><div class="event-feed">${body||'<div class="empty">No visible activity yet.</div>'}</div><div class="team-note"><b>What this demo records</b><small>Invoice and bill events include status updates and shared comments. Repeated identical updates inside 20 minutes are grouped. The demo records the business account that acted; it does not identify individual employees.</small></div></div>`;
}


function insightsPage(){
 const all=roleVisibleRecords();
 const records=all.filter(r=>!['Draft','Paid','Rejected','Resolved'].includes(r.status));
 const days=[['Past due',r=>dueOffset(r.due)!==null&&dueOffset(r.due)<0],['Due in 0–7 days',r=>dueOffset(r.due)!==null&&dueOffset(r.due)>=0&&dueOffset(r.due)<=7],['Due in 8–30 days',r=>dueOffset(r.due)!==null&&dueOffset(r.due)>7&&dueOffset(r.due)<=30],['Due later',r=>dueOffset(r.due)!==null&&dueOffset(r.due)>30]];
 const approvalCount=records.filter(r=>r.status==='Pending approval'||(r.type==='bill'&&me().side==='buyer'&&r.status==='Needs approval')).length;
 const exceptions=records.filter(r=>['Overdue','Dispute'].includes(r.status)||(dueOffset(r.due)!==null&&dueOffset(r.due)<0));
 const risk=exceptions.reduce((n,r)=>n+r.amount,0),soon=records.filter(r=>dueOffset(r.due)!==null&&dueOffset(r.due)>=0&&dueOffset(r.due)<=7).length;
 const max=Math.max(1,...days.map(([,filter])=>records.filter(filter).length));
 const bars=days.map(([label,filter])=>{const n=records.filter(filter).length;return `<div class="bar-row"><div class="bar-title"><span>${label}</span><b>${n}</b></div><div class="bar"><i class="${label==='Past due'?'orange':label.includes('0–7')?'blue':''}" style="--bar-width:${Math.round(n/max*100)}%"></i></div></div>`}).join('');
 const urgent=records.filter(r=>['Overdue','Dispute','Needs approval','Received'].includes(r.status)||(dueOffset(r.due)!==null&&dueOffset(r.due)<=7)).sort((a,b)=>(dueOffset(a.due)??9999)-(dueOffset(b.due)??9999)).slice(0,6);
 const partnerMap=new Map();
 records.forEach(r=>{const p=partnerMap.get(r.party)||{party:r.party,count:0,value:0,late:0,soon:0};p.count+=1;p.value+=r.amount;const d=dueOffset(r.due);if(d!==null&&d<0)p.late+=1;if(d!==null&&d>=0&&d<=7)p.soon+=1;partnerMap.set(r.party,p)});
 const partners=[...partnerMap.values()].sort((a,b)=>b.value-a.value).slice(0,8);
 const partnerRows=partners.map(p=>`<tr><td class="strong">${esc(p.party)}</td><td class="num">${p.count}</td><td class="num">${p.soon||'—'}</td><td class="num ${p.late?'late':''}">${p.late||'—'}</td><td class="strong num">${cash(p.value)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No open partner exposure.</td></tr>';
 const buckets=[['In review',r=>['Pending approval','Needs approval','Received'].includes(r.status),'amber'],['Approved or scheduled',r=>['Approved','Scheduled','Partially paid'].includes(r.status),'green'],['Sent or viewed',r=>['Sent','Viewed'].includes(r.status),'blue'],['Past due',r=>r.status==='Overdue'||(dueOffset(r.due)!==null&&dueOffset(r.due)<0),'orange'],['In dispute',r=>r.status==='Dispute','red']];
 const bmax=Math.max(1,...buckets.map(([,f])=>records.filter(f).length));
 const mix=buckets.map(([label,f,kind])=>{const n=records.filter(f).length;return `<div class="mix-row"><div><span class="mix-dot ${kind}"></span>${label}</div><b>${n}</b><div class="mix-track"><i class="${kind}" style="--mix:${Math.round(n/bmax*100)}%"></i></div></div>`}).join('');
 return `${head('INSIGHTS · WORKFLOW','Flow insights','Due dates, decisions and exceptions from the records visible to this role.')}<div class="metrics">${metric('Due in 7 days',soon,'Open invoices and bills','⌁',soon>0)}${metric('Past due',records.filter(r=>dueOffset(r.due)!==null&&dueOffset(r.due)<0).length,'Open records past due date','!',records.some(r=>dueOffset(r.due)!==null&&dueOffset(r.due)<0))}${metric('Approval queue',approvalCount,'Invoices and bills awaiting review','✓',approvalCount>0)}${metric('Exception value',cash(risk),'Overdue or disputed records','₹',risk>0)}</div><div class="insight-layout"><section class="card panel"><div class="panel-head"><h2>Due-date horizon</h2><span class="subtle">${records.length} unique open records</span></div>${bars}<p class="subtle">A due-date view, not an employee rating.</p></section><section class="card panel"><div class="panel-head"><h2>Needs attention</h2><button class="text-link" data-page="activity">Activity trail →</button></div><div class="attention-list">${urgent.map(r=>`<button class="attention-row" ${r.type==='invoice'?`data-open="${esc(r.id)}"`:'data-page="bills"'}><span><b>${esc(r.id)}</b><small>${esc(r.party)} · ${esc(r.status)}</small></span><strong>${dueOffset(r.due)<0?`${Math.abs(dueOffset(r.due))}d overdue`:dueOffset(r.due)===0?'Due today':`Due ${dateFmt(r.due)}`}</strong></button>`).join('')||'<div class="empty">No urgent records in this role view.</div>'}</div></section></div><div class="insight-lower"><section class="card panel"><div class="panel-head"><h2>Exposure by trading partner</h2><span class="subtle">Open records only</span></div><div class="table-wrap"><table class="table compact-table"><thead><tr><th>Business</th><th class="num">Open</th><th class="num">Due 7d</th><th class="num">Past due</th><th class="num">Value</th></tr></thead><tbody>${partnerRows}</tbody></table></div><p class="subtle">Grouped from the invoices and bills this role can see.</p></section><section class="card panel"><div class="panel-head"><h2>What is open</h2><span class="subtle">By workflow stage</span></div><div class="status-mix">${mix}</div><p class="subtle">Stages come from recorded statuses, not forecasts.</p></section></div><div class="team-note"><b>How to read this</b><small>These indicators show workflow timing and queue volume. The current demo has no employee-level assignment, attendance or productivity data.</small></div>`;
}

function businessPage(){page='connections';return connectionsPage()}
function taxPreview(){const f=$('#invoiceForm');if(!f)return;const qty=Number(f.qty.value||0),rate=Number(f.rate.value||0),tax=Number(f.tax.value||0),base=qty*rate,customer=company(f.customer.value);const breakdown=taxBreakdown(company(me().org).gstin,customer.gstin,base,tax);$('#invoiceTotal').innerHTML=`<div><span>Taxable value</span><b>${cash(base)}</b></div>${breakdown.map(x=>`<div><span>${x.label}</span><b>${cash(x.value)}</b></div>`).join('')}<div class="total-line"><span>Total</span><b>${cash(base+breakdown.reduce((a,x)=>a+x.value,0))}</b></div>`}
function bootPage(){return `<div class="boot-shell" role="status" aria-live="polite"><div class="boot-head"><span class="boot-spinner" aria-hidden="true"></span><div><b>Opening the demo workspace</b><small>Loading sample invoices, bills and partner records from the local API…</small></div></div><div class="boot-metrics"><i></i><i></i><i></i><i></i></div><div class="boot-panel">${'<span></span>'.repeat(7)}</div><p class="boot-note">Local demo · sample data only · nothing leaves this machine</p></div>`}
function render(){const front=['landing','roles'].includes(page);document.querySelector('.app').classList.toggle('front-page',front);document.querySelector('.app').classList.toggle('portal-page',page==='portal');const titles={landing:'Overview',roles:'Choose a role',boot:'Opening demo',overview:'Overview',invoices:'Invoices',detail:'Invoice detail',builder:'Invoice builder',bills:'Bills inbox',billUpload:'Add bill',approvals:'Approvals',disputes:'Disputes',connections:'Connections',network:'Connections',team:'Team workload',calendar:'Calendar',activity:'Activity trail',insights:'Flow insights',payments:'Payment status',portal:portalLabel(),more:'More',...bizTitles()};$('#crumb').textContent=titles[page]||'Overview';const activePage=page==='detail'||page==='builder'?'invoices':page==='billUpload'?'bills':page==='business'?'connections':page;const hidden=roleHiddenPages();document.querySelectorAll('#nav button,.mobile-tabs button').forEach(b=>{const key=b.dataset.page;b.hidden=hidden.has(key);const on=key===activePage||((role==='buyer_portal'||role==='vendor_portal')&&key==='portal');b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});const portalBtn=$('#nav [data-page="portal"]');if(portalBtn)portalBtn.innerHTML=`<span class="icon">↗</span>${portalLabel()}`;const counts=queueCounts();for(const[k,v]of Object.entries(counts)){const x=$(`#nav [data-page="${k}"] .count`);if(x)x.textContent=v}const views={landing:pageLanding,roles:rolePicker,boot:bootPage,overview:dashboard,invoices:invoicesPage,detail:detailPage,builder,bills:billsPage,billUpload,connections:connectionsPage,network:connectionsPage,portal:portalPage,business:businessPage,approvals:approvalsPage,disputes:disputesPage,payments:paymentsPage,team:teamPage,calendar:calendarPage,activity:activityPage,insights:insightsPage,more:morePage,...bizViews()};$('#view').innerHTML=(!state.businesses.length&&!['landing','roles','boot'].includes(page))?`<div class="card panel" role="alert"><h2>Demo data is unavailable</h2><p class="subtle">Workspace records have not loaded, so this view cannot be shown. Check the API connection and retry.</p><p><button class="btn primary" onclick="retryConnection()">Retry connection</button></p></div>`:(views[page]||dashboard)();$('#sidebar').classList.remove('open');if(page==='builder')taxPreview();syncThemeControls();bizAfterRender()}
function updateInvoiceRows(){renderInvoiceTable()}
function updateBillRows(){renderBillTable()}
async function changeInvoiceStatus(id,status,extra={}){await api(`/api/invoices/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status,actor:me().org,...extra})});await refresh();selectedId=id;page='detail';render();toast(`Invoice marked ${status.toLowerCase()}`)}
function exportSelectedInvoices(){const selected=[...document.querySelectorAll('[data-select]:checked')].map(x=>x.dataset.select);const rows=invoicesForRole().filter(i=>selected.includes(i.id));if(!rows.length){toast('Select at least one invoice to export','warn');return}const values=[['Invoice','Business','Issue date','Due date','Amount INR','Status'],...rows.map(i=>[i.id,company(me().side==='supplier'?i.customer:i.supplier).name,i.issue_date,i.due_date,Number(i.total).toFixed(2),i.status])];const csv=values.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='invoiceos-invoices.csv';a.click();URL.revokeObjectURL(url);toast(`${rows.length} invoice${rows.length===1?'':'s'} exported`,'success')}
document.addEventListener('click',async e=>{const themeToggle=e.target.closest('[data-theme-toggle]');if(themeToggle){e.preventDefault();setTheme(currentTheme()==='dark'?'light':'dark',true);return}const mapNode=e.target.closest('[data-map-select]');if(mapNode){document.querySelectorAll('[data-map-select]').forEach(n=>{n.setAttribute('aria-pressed',String(n===mapNode))});const[key,title,description]=mapFeatures[mapNode.dataset.mapSelect]||[];const focus=$('.map-focus');if(focus&&title)focus.innerHTML=`<b>${esc(title)}</b><span>${esc(description)}</span>`;return}
const earlyStatus=e.target.closest('[data-status]');if(earlyStatus){const[id,next]=earlyStatus.dataset.status.split('|');try{await changeInvoiceStatus(id,next)}catch(err){toast(err.message,'error')}return}
const earlyBill=e.target.closest('[data-bill-status]');if(earlyBill){const[id,next]=earlyBill.dataset.billStatus.split('|');const back=page;try{await api(`/api/bills/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status:next,actor:me().org,role})});await refresh();page=back;render();toast(`Bill marked ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}
const earlyConn=e.target.closest('[data-connection]');if(earlyConn){const[id,next]=earlyConn.dataset.connection.split('|');const back=page;try{await api(`/api/connections/${encodeURIComponent(id)}/status`,{method:'POST',body:JSON.stringify({status:next,actor:me().org,role})});await refresh();page=back;render();toast(`Connection ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}
const statusFilter=e.target.closest('[data-status-filter]');if(statusFilter){invoiceFilters={...invoiceFilters,status:statusFilter.dataset.statusFilter,q:''};page='invoices';render();return}const quickStatus=e.target.closest('[data-quick-status]');if(quickStatus){invoiceFilters.status=quickStatus.dataset.quickStatus;const sel=$('#invoiceStatus');if(sel)sel.value=invoiceFilters.status;document.querySelectorAll('[data-quick-status]').forEach(b=>b.classList.toggle('active',b.dataset.quickStatus===invoiceFilters.status));renderInvoiceTable();return}const sortBtn=e.target.closest('[data-sort]');if(sortBtn){const k=sortBtn.dataset.sort;if(invoiceSort.key===k)invoiceSort.dir*=-1;else{invoiceSort.key=k;invoiceSort.dir=['issue_date','due_date','total'].includes(k)?-1:1}renderInvoiceTable();return}const rolePick=e.target.closest('[data-role-pick]');if(rolePick){if(!demoRoute){location.href='/demo?role='+encodeURIComponent(rolePick.dataset.rolePick);return}changeRole(rolePick.dataset.rolePick);return}const teamRole=e.target.closest('[data-team-role]');if(teamRole){changeRole(teamRole.dataset.teamRole);if(me().external){return}page='team';render();return}const nav=e.target.closest('[data-page]');if(nav){if(!demoRoute){location.href='/demo?page='+encodeURIComponent(nav.dataset.page);return}page=nav.dataset.page;render();return}if(e.target.closest('[data-select],#selectAll'))return;const open=e.target.closest('[data-open]');if(open){if(!demoRoute){location.href='/demo?page=detail&id='+encodeURIComponent(open.dataset.open);return}selectedId=open.dataset.open;const opened=state.invoices.find(i=>i.id===selectedId);if(me().side==='buyer'&&opened?.status==='Sent'){try{await changeInvoiceStatus(selectedId,'Viewed')}catch(err){toast(err.message,'error')}return}page='detail';render();return}const status=e.target.closest('[data-status]');if(status){const[id,next]=status.dataset.status.split('|');try{await changeInvoiceStatus(id,next)}catch(err){toast(err.message,'error')}return}const bs=e.target.closest('[data-bill-status]');if(bs){const[id,next]=bs.dataset.billStatus.split('|');try{await api(`/api/bills/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status:next,actor:me().org,role})});await refresh();page='bills';render();toast(`Bill marked ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}const con=e.target.closest('[data-connection]');if(con){const[id,next]=con.dataset.connection.split('|');try{await api(`/api/connections/${encodeURIComponent(id)}/status`,{method:'POST',body:JSON.stringify({status:next,actor:me().org,role})});await refresh();page='connections';render();toast(`Connection ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;if(action==='submit-invoice'){const f=$('#invoiceForm');if(!f?.reportValidity())return;if(me().readOnly||!me().create)return;const payload=Object.fromEntries(new FormData(f).entries());payload.supplier=me().org;for(const k of ['qty','rate','tax'])payload[k]=Number(payload[k]);try{await api('/api/invoices',{method:'POST',body:JSON.stringify(payload)});await refresh();page='invoices';render();toast('Invoice shared with buyer','success')}catch(err){toast(err.message,'error')}return}else if(action.startsWith('status|')){const[,id,next]=action.split('|');try{await changeInvoiceStatus(id,next)}catch(err){toast(err.message,'error')}}else if(action==='landing'){page='landing';render()}else if(action==='roles'){page='roles';render()}else if(action==='new'||action==='invoices'||action==='builder'||action==='bills'||action==='connections'||action==='payments'||action==='portal'||action==='overview'||action==='refresh'){if(action==='refresh')await refresh();else{page=me().external&&action!=='portal'?'portal':action;render()}}else if(action==='showDispute'){const form=$('#disputeForm');if(form)form.style.display='block'}else if(action==='billUpload'){page='billUpload';render()}else if(action==='sample-ocr'){const f=$('#billForm');if(f){f.vendor.value='northstar';f.vendor_invoice_id.value='NS-2026-0192';f.description.value='Brand identity and campaign design';f.amount.value='186000';f.po_number.value='MR-PO-880';f.confidence.value='99% · Review suggested';toast('Sample fields filled — review before saving')}}else if(action==='invite'){const f=$('#connectionForm');if(f){f.hidden=false;f.querySelector('[name=name]')?.focus()}}else if(action==='approve-all'){try{const c=queueCounts();const n=c.invoicePending.length+c.billPending.length;for(const i of c.invoicePending)await api(`/api/invoices/${encodeURIComponent(i.id)}/status`,{method:'PATCH',body:JSON.stringify({status:'Approved',actor:me().org})});for(const b of c.billPending)await api(`/api/bills/${encodeURIComponent(b.id)}/status`,{method:'PATCH',body:JSON.stringify({status:'Approved',actor:me().org})});await refresh();page='approvals';render();toast(`Approved ${n} record${n===1?'':'s'}`)}catch(err){toast(err.message,'error')}}else if(action==='cancel-invite'){const f=$('#connectionForm');if(f){f.reset();f.hidden=true}}else if(action==='global-search'){openCmdk()}else if(action==='bulk-remind'){toast('Reminder draft prepared. No message sent in demo.')}else if(action==='bulk-export'){exportSelectedInvoices()} });
document.addEventListener('input',e=>{if(e.target.id==='invoiceSearch'){invoiceFilters.q=e.target.value;updateInvoiceRows()}if(e.target.id==='billSearch')updateBillRows();if(e.target.closest('#invoiceForm'))taxPreview()});document.addEventListener('change',e=>{if(e.target.id==='activityFilter'){const v=e.target.value;document.querySelectorAll('.event-day').forEach(day=>{let shown=0;day.querySelectorAll('.activity-record').forEach(row=>{const ok=v==='all'||row.dataset.activityKind===v;row.hidden=!ok;if(ok)shown++});day.hidden=!shown})}if(e.target.id==='invoiceStatus'){invoiceFilters.status=e.target.value;updateInvoiceRows()}if(e.target.id==='billStatus')updateBillRows();if(e.target.id==='selectAll')document.querySelectorAll('[data-select]').forEach(c=>c.checked=e.target.checked);if(e.target.matches('[data-select],#selectAll')){const n=document.querySelectorAll('[data-select]:checked').length;$('#bulkBar')?.classList.add('show');if($('#selectedCount'))$('#selectedCount').textContent=`${n} selected`}if(e.target.closest('#invoiceForm'))taxPreview()});
document.addEventListener('submit',async e=>{if(e.target.id==='connectionForm'){e.preventDefault();const f=new FormData(e.target);try{await api('/api/businesses',{method:'POST',body:JSON.stringify({name:f.get('name'),email:f.get('email'),gstin:f.get('gstin'),requester:me().org,scopes:f.getAll('scopes')})});await refresh();page='connections';render();toast('Connection request created — no email was sent','success')}catch(err){toast(err.message,'error')}}if(e.target.id==='invoiceForm'){e.preventDefault();if(me().readOnly||!me().create)return;const payload=Object.fromEntries(new FormData(e.target).entries());payload.supplier=me().org;for(const k of ['qty','rate','tax'])payload[k]=Number(payload[k]);try{await api('/api/invoices',{method:'POST',body:JSON.stringify(payload)});await refresh();page='invoices';render();toast('Invoice shared with buyer','success')}catch(err){toast(err.message,'error')}}if(e.target.id==='commentForm'){e.preventDefault();try{await api(`/api/invoices/${encodeURIComponent(selectedId)}/comments`,{method:'POST',body:JSON.stringify({body:new FormData(e.target).get('body'),actor:me().org})});await refresh();page='detail';render();toast('Reply added to shared invoice','success')}catch(err){toast(err.message,'error')}}if(e.target.id==='disputeForm'){e.preventDefault();const reason=new FormData(e.target).get('reason');try{await api(`/api/invoices/${encodeURIComponent(selectedId)}/status`,{method:'PATCH',body:JSON.stringify({status:'Dispute',actor:me().org,dispute_reason:reason})});await api(`/api/invoices/${encodeURIComponent(selectedId)}/comments`,{method:'POST',body:JSON.stringify({body:`Query raised: ${reason}`,actor:me().org})});await changeInvoiceStatus(selectedId,'Dispute',{dispute_reason:reason})}catch(err){toast(err.message,'error')}}if(e.target.id==='billForm'){e.preventDefault();const f=new FormData(e.target);const rawConfidence=parseFloat(f.get('confidence'))||0;const payload={buyer:me().org,vendor:f.get('vendor'),vendor_invoice_id:f.get('vendor_invoice_id'),description:f.get('description'),amount:Number(f.get('amount')),due_date:f.get('due_date'),po_number:f.get('po_number'),source:'manual',status:'Received',ocr_confidence:rawConfidence>1?rawConfidence/100:rawConfidence};try{await api('/api/bills',{method:'POST',body:JSON.stringify(payload)});await refresh();page='bills';render();toast('Bill saved to the AP inbox','success')}catch(err){toast(err.message,'error')}}});
$('#role').innerHTML=Object.entries(profiles).map(([id,p])=>`<option value="${id}">${esc(p.label)}</option>`).join('');$('#role').addEventListener('change',e=>changeRole(e.target.value));document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCmdk();return}const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'')||document.activeElement?.isContentEditable;if(e.key==='/'&&!typing&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();openCmdk();return}if(e.key==='Escape'&&page==='detail'&&!cmdkOpen()){page=me().external?'portal':'invoices';render()}});

/* ===================================================================
   Command palette + recovery feedback. Everything here is client-side:
   records come from the same local API, and nothing is invented.
   =================================================================== */
const cmdkState={open:false,items:[],index:0,query:'',timer:null,seq:0,restore:null,server:[]};
function cmdkOpen(){return cmdkState.open}
function cmdkCommands(query){
 const needle=(query||'').trim().toLowerCase();
 const hidden=roleHiddenPages();
 const pages=[
  ['overview','Dashboard','Workspace overview','◫'],
  ['invoices','Invoices','Filter, sort and action invoices','▤'],
  ['bills','Bills inbox','Captured supplier bills','▣'],
  ['approvals','Approvals','Records waiting for a decision','✓'],
  ['disputes','Disputes','Queries and exceptions','⚑'],
  ['connections','Connections','Partner network and scopes','◎'],
  ['payments','Payment status','Settlement status shared by partners','₹'],
  ['calendar','Calendar','Meetings, assigned work and deadlines','▦'],
  ['team','Team workload','Role queues and sample personas','♙'],
  ['activity','Activity trail','Append-only record of actions','◷'],
  ['insights','Flow insights','Due-date horizon and queues','⌁'],
  ['portal',portalLabel(),me().side==='buyer'?'Shared buyer view':'Shared supplier view','↗']
 ];
 const out=pages.filter(([key])=>!hidden.has(key)).map(([key,title,subtitle,glyph])=>({type:'page',id:'page:'+key,title,subtitle,glyph,page:key,hay:(title+' '+subtitle+' '+key).toLowerCase()}));
 if(me().create)out.unshift({type:'action',id:'action:new-invoice',title:'Create invoice',subtitle:'Open the invoice builder',glyph:'+',action:'new-invoice',hay:'create new invoice builder sales'});
 if(me().side==='buyer'&&!me().readOnly)out.unshift({type:'action',id:'action:new-bill',title:'Add a bill',subtitle:'Capture a supplier bill in the AP inbox',glyph:'▣',action:'new-bill',hay:'add new bill upload ap purchase'});
 if(!me().external&&!['landing','roles','portal'].includes(page))out.push({type:'action',id:'action:orb',title:'Open the workspace orb',subtitle:'Spin to a queue · Alt+O',glyph:'◉',action:'orb',hay:'orb navigator spin workspace'});
 out.push({type:'action',id:'action:refresh',title:'Refresh workspace',subtitle:'Reload records from the local API',glyph:'↻',action:'refresh',hay:'refresh reload sync api'});
 out.push({type:'action',id:'action:roles',title:'Switch role',subtitle:'Choose a different permission view',glyph:'♙',action:'roles',hay:'switch role permissions view as'});
 out.push({type:'action',id:'action:landing',title:'Back to landing page',subtitle:'Return to the demo overview',glyph:'⌂',action:'landing',hay:'landing home overview demo'});
 return needle?out.filter(item=>item.hay.includes(needle)):out;
}
function cmdkParty(invoice){return company(me().side==='supplier'?invoice.customer:invoice.supplier).name}
function cmdkLocal(query){
 const needle=query.trim().toLowerCase();if(!needle)return[];
 const out=[];
 for(const i of invoicesForRole()){
  const party=cmdkParty(i),hay=[i.id,i.description,i.po_number,party,i.status].join(' ').toLowerCase();
  if(!hay.includes(needle))continue;
  out.push({type:'invoice',id:i.id,title:i.id,subtitle:party+' · '+cash(i.total),meta:i.status,detail:i.description,glyph:'▤',page:'detail'});
  if(out.length>=6)break;
 }
 if(out.length<8)for(const b of billsForRole()){
  const party=company(me().side==='buyer'?b.vendor:b.buyer).name,hay=[b.id,b.description,b.po_number,b.vendor_invoice_id,party,b.status].join(' ').toLowerCase();
  if(!hay.includes(needle))continue;
  out.push({type:'bill',id:b.id,title:b.id,subtitle:party+' · '+cash(b.amount),meta:b.status,detail:b.description,glyph:'▣',page:'bills'});
  if(out.length>=10)break;
 }
 for(const b of state.businesses){
  const hay=[b.name,b.city,b.gstin].join(' ').toLowerCase();
  if(!hay.includes(needle))continue;
  const connected=b.id===me().org||isConnected(me().org,b.id);
  if(!connected)continue;
  out.push({type:'business',id:b.id,title:b.name,subtitle:[b.city,b.gstin].filter(Boolean).join(' · ')||'Business profile',meta:b.kind,detail:b.email,glyph:'◎',page:'connections'});
  if(out.length>=12)break;
 }
 return out;
}
function cmdkRender(query){
 const list=$('#cmdkList');if(!list)return;
 cmdkState.query=query||'';
 const local=cmdkLocal(cmdkState.query);
 const merged=[...cmdkCommands(cmdkState.query),...local,...cmdkState.server];
 const seen=new Set();
 cmdkState.items=merged.filter(item=>{const key=item.type+':'+item.id;if(seen.has(key))return false;seen.add(key);return true}).slice(0,40);
 if(cmdkState.index>=cmdkState.items.length)cmdkState.index=Math.max(0,cmdkState.items.length-1);
 if(!cmdkState.items.length){
  list.innerHTML=`<div class="cmdk-empty"><b>No matches</b><br>Try an invoice number, business name, amount or page.</div>`;
  $('#cmdkInput')?.removeAttribute('aria-activedescendant');
  return;
 }
 let html='',group='';
 cmdkState.items.forEach((item,index)=>{
  const label=item.type==='page'?'Go to':item.type==='action'?'Actions':item.type==='invoice'?'Invoices':item.type==='bill'?'Bills':item.type==='business'?'Businesses':'Records';
  if(label!==group){group=label;html+=`<div class="cmdk-group" role="presentation">${label}</div>`}
  html+=`<button type="button" class="cmdk-item${index===cmdkState.index?' is-active':''}" id="cmdkItem${index}" role="option" aria-selected="${index===cmdkState.index}" data-cmdk-index="${index}"><span class="cmdk-item-glyph" aria-hidden="true">${item.glyph||'›'}</span><span class="cmdk-item-copy"><b>${esc(item.title)}</b><small>${esc(item.subtitle||'')}${item.detail?' · '+esc(item.detail):''}</small></span>${item.meta?`<span class="cmdk-item-meta">${esc(item.meta)}</span>`:''}</button>`;
 });
 list.innerHTML=html;
 const input=$('#cmdkInput');if(input)input.setAttribute('aria-activedescendant','cmdkItem'+cmdkState.index);
 const active=$('#cmdkItem'+cmdkState.index);if(active)active.scrollIntoView({block:'nearest'});
}
function cmdkSearch(query){
 clearTimeout(cmdkState.timer);
 const seq=++cmdkState.seq;
 if(!query.trim()){cmdkState.server=[];cmdkRender(query);return}
 cmdkRender(query);
 cmdkState.timer=setTimeout(async()=>{
  const list=$('#cmdkList');if(list)list.setAttribute('aria-busy','true');
  try{
   const params=new URLSearchParams({q:query.trim(),org:me().org,side:me().side,limit:'10'});
   const data=await api('/api/search?'+params.toString());
   if(seq!==cmdkState.seq)return;
   cmdkState.server=(data.results||[]).filter(r=>!(me().external&&r.type==='invoice'&&r.meta==='Draft')).map(r=>({...r,glyph:r.type==='invoice'?'▤':r.type==='bill'?'▣':'◎',subtitle:[r.subtitle,r.amount!=null?cash(r.amount):''].filter(Boolean).join(' · '),detail:r.detail||''}));
  }catch(_){cmdkState.server=[]}
  finally{if(list&&seq===cmdkState.seq)list.removeAttribute('aria-busy')}
  if(seq===cmdkState.seq)cmdkRender(query);
 },180);
}
function cmdkRun(item){
 if(!item)return;
 closeCmdk();
 if(item.type==='invoice'){selectedId=item.id;page='detail';render();return}
 if(item.type==='bill'){page='bills';render();return}
 if(item.type==='business'){page='connections';render();return}
 if(item.type==='page'){page=item.page;render();return}
 if(item.type!=='action')return;
 if(item.action==='new-invoice'){page='builder';render()}
 else if(item.action==='new-bill'){page='billUpload';render()}
 else if(item.action==='refresh'){refresh().then(()=>toast('Workspace refreshed','success')).catch(err=>toast(err.message,'error'))}
 else if(item.action==='orb'){setTimeout(()=>window.InvoiceOSOrb?.open(),140)}
 else if(item.action==='roles'){page='roles';render()}
 else if(item.action==='landing'){page='landing';render()}
}
function cmdkStep(delta){
 if(!cmdkState.items.length)return;
 cmdkState.index=(cmdkState.index+delta+cmdkState.items.length)%cmdkState.items.length;
 cmdkRender($('#cmdkInput')?.value||'');
}
function cmdkTrap(e){
 const panel=$('.cmdk-panel');if(!panel)return;
 const focusables=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length);
 if(!focusables.length)return;
 const current=focusables.indexOf(document.activeElement);
 if(e.shiftKey){if(current<=0){e.preventDefault();focusables[focusables.length-1].focus()}}
 else if(current===-1||current===focusables.length-1){e.preventDefault();focusables[0].focus()}
}
function cmdkKey(e){
 if(!cmdkState.open)return;
 if(e.key==='Escape'){e.preventDefault();closeCmdk();return}
 if(e.key==='ArrowDown'){e.preventDefault();cmdkStep(1);return}
 if(e.key==='ArrowUp'){e.preventDefault();cmdkStep(-1);return}
 if(e.key==='Home'){e.preventDefault();cmdkState.index=0;cmdkRender($('#cmdkInput')?.value||'');return}
 if(e.key==='End'){e.preventDefault();cmdkState.index=Math.max(0,cmdkState.items.length-1);cmdkRender($('#cmdkInput')?.value||'');return}
 if(e.key==='Enter'){e.preventDefault();cmdkRun(cmdkState.items[cmdkState.index]);return}
 if(e.key==='Tab'){cmdkTrap(e);return}
}
function ensureCmdk(){
 let el=$('#cmdk');
 if(el)return el;
 el=document.createElement('div');
 el.id='cmdk';el.className='cmdk';el.hidden=true;
 el.innerHTML=`<div class="cmdk-panel" role="dialog" aria-modal="true" aria-labelledby="cmdkTitle">
  <div class="cmdk-head"><span class="cmdk-mark" aria-hidden="true">⌘</span><label class="sr-only" id="cmdkTitle">Command palette</label><input id="cmdkInput" type="text" role="combobox" aria-autocomplete="list" aria-controls="cmdkList" aria-expanded="true" autocomplete="off" spellcheck="false" placeholder="Search invoices, bills, businesses or pages…"><button type="button" class="cmdk-esc" data-cmdk-close>Esc</button></div>
  <div class="cmdk-list" id="cmdkList" role="listbox" aria-label="Command results"></div>
  <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span><span id="cmdkHint">Type to search records</span></div>
 </div>`;
 document.body.appendChild(el);
 el.addEventListener('pointerdown',e=>{if(e.target===el)closeCmdk()});
 el.querySelector('[data-cmdk-close]')?.addEventListener('click',()=>closeCmdk());
 el.querySelector('#cmdkInput')?.addEventListener('input',e=>cmdkSearch(e.target.value));
 el.addEventListener('click',e=>{
  const pick=e.target.closest('[data-cmdk-index]');
  if(pick){cmdkState.index=Number(pick.dataset.cmdkIndex);cmdkRun(cmdkState.items[cmdkState.index])}
 });
 document.addEventListener('keydown',cmdkKey);
 return el;
}
function openCmdk(){
 const el=ensureCmdk();
 if(!el)return;
 if(cmdkState.open){$('#cmdkInput')?.focus();return}
 if(window.InvoiceOSOrb?.isOpen())window.InvoiceOSOrb.close(false);
 cmdkState.open=true;cmdkState.restore=document.activeElement;cmdkState.index=0;cmdkState.server=[];cmdkState.seq++;
 clearTimeout(cmdkState.timer);
 el.hidden=false;requestAnimationFrame(()=>el.classList.add('open'));
 document.body.classList.add('cmdk-open');
 const trigger=$('[data-action="global-search"]');if(trigger)trigger.setAttribute('aria-expanded','true');
 const input=$('#cmdkInput');if(input){input.value='';input.setAttribute('aria-activedescendant','cmdkItem0')}
 cmdkRender('');
 setTimeout(()=>{if(cmdkState.open)input?.focus()},30);
}
function closeCmdk(){
 const el=$('#cmdk');if(!el||!cmdkState.open)return;
 cmdkState.open=false;el.classList.remove('open');
 clearTimeout(cmdkState.timer);cmdkState.seq++;
 document.body.classList.remove('cmdk-open');
 const trigger=$('[data-action="global-search"]');if(trigger)trigger.setAttribute('aria-expanded','false');
 setTimeout(()=>{if(!cmdkState.open)el.hidden=true},180);
 const restore=cmdkState.restore;cmdkState.restore=null;
 const target=(restore&&restore!==document.body&&document.contains(restore)&&typeof restore.focus==='function')?restore:$('[data-action="global-search"]');
 if(target&&typeof target.focus==='function')setTimeout(()=>target.focus(),0);
 else $('#wsOrbFab')?.focus?.();
}

/* ---------- Calendar: meetings and assigned work (demo people, no real invites or notifications) ---------- */
const CAL_ROLES={owner:{auth:true},finance_manager:{auth:true},approver:{auth:true},ar:{},ap:{},auditor:{ro:true}};
const isoDay=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const calToday=()=>isoDay(new Date());
const calParts=iso=>String(iso||'').split('-').map(Number);
const calAddDays=(iso,n)=>{const[y,m,d]=calParts(iso);return isoDay(new Date(y,m-1,d+n))};
const calDayNum=iso=>{const[y,m,d]=calParts(iso);return Date.UTC(y,m-1,d)/864e5};
const calLong=iso=>{const[y,m,d]=calParts(iso);return new Date(y,m-1,d).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})};
const calShort=iso=>{if(!iso)return'—';const[y,m,d]=calParts(iso);return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
const calTime=t=>{if(!/^\d\d:\d\d$/.test(t||''))return'';let[h,m]=t.split(':').map(Number);const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+String(m).padStart(2,'0')+' '+ap};
let calView=(()=>{const t=calToday();return{y:+t.slice(0,4),m:+t.slice(5,7)-1}})(),calSel=calToday(),calForm='',calFilter='all',calError='';
const calMe=()=>CAL_ROLES[role]||null;
const staffOrg=()=>(state.staff||[]).filter(s=>s.org===me().org);
const staffById=id=>(state.staff||[]).find(s=>s.id===id)||null;
const staffTag=id=>{const s=staffById(id);return s?`${s.name} · ${s.title}`:'Unknown'};
const calMeStaff=()=>staffOrg().find(s=>s.role_key===role)||null;
const calEvents=()=>(state.calendar_events||[]).filter(e=>e.org===me().org);
const calList=s=>{try{const v=JSON.parse(s);return Array.isArray(v)?v:[]}catch(_){return[]}};
const calLate=e=>e.kind==='task'&&e.status!=='Done'&&e.due_date<calToday();
function calOpenCount(){const c=calMe(),who=calMeStaff();if(!c||!who)return 0;const t=calEvents().filter(e=>e.kind==='task'&&e.status!=='Done');return c.auth?t.length:t.filter(e=>e.assignee_staff===who.id).length}
function calDue(e){if(e.status==='Done')return{text:'Done',cls:'ok'};const d=calDayNum(e.due_date)-calDayNum(calToday());if(d<0)return{text:`${-d} day${d===-1?'':'s'} overdue`,cls:'late'};if(d===0)return{text:'Due today',cls:'soon'};if(d===1)return{text:'1 day left',cls:'soon'};return{text:`${d} days left`,cls:''}}
function calBadge(s){const k={'Done':'paid','In progress':'sent','Open':'review','Scheduled':'sent','Cancelled':'overdue','Completed':'paid'}[s]||'pending';return `<span class="status s-${k}">${esc(s)}</span>`}
function calMeetingItem(e,c){
 const att=calList(e.attendees).map(staffTag),past=e.start_date<calToday()&&e.status!=='Cancelled',label=e.status==='Cancelled'?'Cancelled':past?'Completed':'Scheduled';
 return `<article class="cal-item${e.status==='Cancelled'?' off':''}"><div class="cal-time">${esc(calTime(e.start_time))}<small>to ${esc(calTime(e.end_time))}</small></div><div><b>${esc(e.title)}</b>${e.description?`<p>${esc(e.description)}</p>`:''}<small>Scheduled by ${esc(staffTag(e.created_by_staff))}</small>${att.length?`<small>With ${att.map(esc).join(', ')}</small>`:''}</div><div class="cal-side">${calBadge(label)}${c.auth&&e.status==='Scheduled'&&!past?`<button type="button" class="text-link" data-cal-cancel="${esc(e.id)}">Cancel meeting</button>`:''}</div></article>`;
}
function calTaskItem(e){const d=calDue(e);return `<article class="cal-item task"><div class="cal-time">Deadline<small>${esc(calShort(e.due_date))}</small></div><div><b>${esc(e.title)}</b>${e.description?`<p>${esc(e.description)}</p>`:''}<small>Assigned to ${esc(staffTag(e.assignee_staff))} by ${esc(staffTag(e.created_by_staff))}</small></div><div class="cal-side">${calBadge(e.status)}<span class="cal-due ${d.cls}">${esc(d.text)}</span></div></article>`}
function calTaskRows(tasks,c,who){
 return tasks.map(e=>{
  const mine=who&&e.assignee_staff===who.id,d=calDue(e),canAll=!!c.auth,canMine=!c.auth&&!c.ro&&mine;
  const next={'Open':['Open','In progress'],'In progress':['In progress','Done'],'Done':['Done','In progress']}[e.status]||[e.status];
  const opts=(canAll?['Open','In progress','Done']:next).map(o=>`<option${o===e.status?' selected':''}>${o}</option>`).join('');
  const status=(canAll||canMine)?`<select class="cal-select" data-cal-status="${esc(e.id)}" aria-label="Status for ${esc(e.title)}">${opts}</select>`:calBadge(e.status);
  const deadline=canAll?`<input type="date" class="cal-select" data-cal-due="${esc(e.id)}" value="${esc(e.due_date)}" min="${calToday()}" aria-label="Deadline for ${esc(e.title)}">`:`<b>${esc(calShort(e.due_date))}</b>`;
  return `<tr><td class="strong">${esc(e.title)}${e.description?`<small class="row-note">${esc(e.description)}</small>`:''}<small class="row-note">Set by ${esc(staffTag(e.created_by_staff))}</small></td><td>${esc(staffById(e.assignee_staff)?.name||'Unknown')}<small class="row-note">${esc(staffById(e.assignee_staff)?.title||'')}${mine?' · you':''}</small></td><td>${deadline}<small class="row-note cal-due ${d.cls}">${esc(d.text)}</small></td><td>${e.priority==='High'?'<span class="status s-pending">High</span>':'<span class="subtle">Normal</span>'}</td><td>${status}</td></tr>`;
 }).join('');
}
function calFormCard(c){
 if(!calForm||!c.auth)return'';
 const staff=staffOrg(),emps=staff.filter(s=>!CAL_ROLES[s.role_key]?.auth),today=calToday(),day=calSel>=today?calSel:today;
 const common=`<div class="field full"><label for="calTitle">Title</label><input id="calTitle" name="title" required maxlength="120" autocomplete="off"></div>`;
 const desc=`<div class="field full"><label for="calDesc">Description <span class="subtle">(optional)</span></label><input id="calDesc" name="description" maxlength="500" autocomplete="off"></div>`;
 const body=calForm==='meeting'
  ?`${common}<div class="field"><label for="calDate">Date</label><input id="calDate" name="start_date" type="date" required min="${today}" value="${day}"></div><div class="field"><label for="calStart">Start time</label><input id="calStart" name="start_time" type="time" required value="10:00"></div><div class="field"><label for="calEnd">End time</label><input id="calEnd" name="end_time" type="time" required value="10:30"></div><div class="field full"><label>Attendees</label><div class="cal-checks">${staff.map(s=>`<label class="cal-check"><input type="checkbox" name="attendees" value="${esc(s.id)}"${s.id===calMeStaff()?.id?' checked disabled':''}> ${esc(s.name)} · ${esc(s.title)}</label>`).join('')}</div></div>${desc}`
  :`${common}<div class="field"><label for="calWho">Assign to</label><select id="calWho" name="assignee_staff" required><option value="">Choose employee</option>${emps.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.title)}</option>`).join('')}</select></div><div class="field"><label for="calDueNew">Complete by</label><input id="calDueNew" name="due_date" type="date" required min="${today}" value="${calAddDays(today,3)}"></div><div class="field"><label for="calPri">Priority</label><select id="calPri" name="priority"><option>Normal</option><option>High</option></select></div>${desc}`;
 return `<section class="card panel cal-form-card" aria-label="${calForm==='meeting'?'Schedule a meeting':'Assign work'}">${panelTitle(calForm==='meeting'?'Schedule a meeting':'Assign work')}<form id="calForm" novalidate><div class="form-grid">${body}</div><p class="cal-error" id="calError" role="alert">${esc(calError)}</p><p class="subtle">${calForm==='meeting'?'Attendees see this on their own calendar. No invitation is emailed in this demo.':'The assignee sees this task under Assigned work. No notification is sent in this demo.'}</p><div class="cal-actions"><button type="button" class="btn" data-cal-form="">Cancel</button><button class="btn primary">${calForm==='meeting'?'Schedule meeting':'Assign work'}</button></div></form></section>`;
}
function calendarPage(){
 const c=calMe(),who=calMeStaff();
 if(!c||!who)return `${head('PEOPLE & WORK','Calendar','Meetings and assigned work for your team.')}<div class="card panel"><p class="subtle">The calendar is not available for this role, or its data has not loaded yet.</p></div>`;
 const ev=calEvents(),today=calToday(),weekEnd=calAddDays(today,6);
 const meetings=ev.filter(e=>e.kind==='meeting'),tasks=ev.filter(e=>e.kind==='task').sort((a,b)=>(a.status==='Done')-(b.status==='Done')||a.due_date.localeCompare(b.due_date));
 const shown=calFilter==='mine'?tasks.filter(t=>t.assignee_staff===who.id):tasks;
 const open=tasks.filter(t=>t.status!=='Done'),late=tasks.filter(calLate);
 const byDay={};for(const e of ev){const k=e.kind==='meeting'?e.start_date:e.due_date;(byDay[k]=byDay[k]||[]).push(e)}
 const first=new Date(calView.y,calView.m,1),lead=(first.getDay()+6)%7,count=new Date(calView.y,calView.m+1,0).getDate(),cells=[];
 for(let i=0;i<lead;i++)cells.push(null);for(let d=1;d<=count;d++)cells.push(isoDay(new Date(calView.y,calView.m,d)));while(cells.length%7)cells.push(null);
 const cell=iso=>{if(!iso)return '<span class="cal-day blank" aria-hidden="true"></span>';const list=(byDay[iso]||[]).slice().sort((a,b)=>(a.start_time||'99').localeCompare(b.start_time||'99'));const m=list.filter(e=>e.kind==='meeting'&&e.status!=='Cancelled').length,t=list.filter(e=>e.kind==='task').length;const label=calLong(iso)+(m?`, ${m} meeting${m>1?'s':''}`:'')+(t?`, ${t} deadline${t>1?'s':''}`:'');const chips=list.slice(0,2).map(e=>`<span class="cal-chip ${e.kind==='meeting'?'m':'t'}${calLate(e)?' late':''}${e.status==='Cancelled'?' off':''}">${esc(e.title)}</span>`).join('')+(list.length>2?`<span class="cal-more">+${list.length-2}</span>`:'');return `<button type="button" class="cal-day${iso===today?' today':''}${iso===calSel?' sel':''}" data-cal-day="${iso}" aria-label="${esc(label)}" aria-pressed="${iso===calSel}"${iso===today?' aria-current="date"':''}><b>${+iso.slice(8)}</b><span class="cal-chips">${chips}</span></button>`};
 const dayList=(byDay[calSel]||[]).slice().sort((a,b)=>(a.start_time||'99').localeCompare(b.start_time||'99'));
 const agenda=dayList.map(e=>e.kind==='meeting'?calMeetingItem(e,c):calTaskItem(e)).join('')||`<p class="empty cal-empty">Nothing scheduled for this day.${c.auth?' Use “Schedule meeting” or “Assign work” to add something.':''}</p>`;
 const monthTitle=new Date(calView.y,calView.m,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
 const actions=c.auth?`<button type="button" class="btn primary" data-cal-form="meeting">＋ Schedule meeting</button><button type="button" class="btn" data-cal-form="task">Assign work</button>`:`<span class="cal-viewonly" title="Only owners, finance managers and approvers can schedule meetings or assign work">View only · ${esc(who.name)}</span>`;
 const weekMeet=meetings.filter(e=>e.status==='Scheduled'&&e.start_date>=today&&e.start_date<=weekEnd).length;
 return `${head('PEOPLE & WORK','Calendar',c.auth?'Schedule meetings and assign work with a completion date. Everyone in the team can see the calendar.':'See team meetings and the work assigned to you. Only managers can schedule or assign.',actions)}<div class="metrics">${metric('Meetings this week',weekMeet,'Scheduled in the next 7 days','▦')}${metric('Open work',open.length,'Not yet done','◷')}${metric('Overdue',late.length,'Past their deadline','⚑',late.length>0)}${metric('Done',tasks.length-open.length,'Completed tasks','✓')}</div>${calFormCard(c)}<div class="cal-layout"><section class="card panel cal-month" aria-label="Month calendar"><div class="cal-top"><h2>${esc(monthTitle)}</h2><div class="cal-nav"><button type="button" class="btn" data-cal-nav="prev" aria-label="Previous month">‹</button><button type="button" class="btn" data-cal-nav="today">Today</button><button type="button" class="btn" data-cal-nav="next" aria-label="Next month">›</button></div></div><div class="cal-week" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div><div class="cal-grid" role="group" aria-label="${esc(monthTitle)}">${cells.map(cell).join('')}</div><p class="subtle cal-legend"><i class="m"></i> Meeting <i class="t"></i> Deadline <i class="late"></i> Overdue</p></section><section class="card panel cal-agenda" aria-live="polite">${panelTitle(esc(calLong(calSel)))}${agenda}</section></div><section class="card panel cal-work">${panelTitle('Assigned work','<div class="cal-filter"><button type="button" class="quick-chip'+(calFilter==='all'?' active':'')+'" data-cal-filter="all">All work</button><button type="button" class="quick-chip'+(calFilter==='mine'?' active':'')+'" data-cal-filter="mine">Assigned to me</button></div>')}<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Assigned to</th><th>Complete by</th><th>Priority</th><th>Status</th></tr></thead><tbody>${calTaskRows(shown,c,who)||`<tr><td colspan="5" class="empty">${calFilter==='mine'?'Nothing is assigned to you right now.':'No work has been assigned yet.'}</td></tr>`}</tbody></table></div><p class="subtle">${c.auth?'You can change deadlines and statuses here.':c.ro?'Your role is read only, so statuses are shown but cannot be changed.':'You can move your own tasks forward from Open to In progress to Done.'} Demo data: people are fictional and nothing is emailed.</p></section>`;
}
async function calPatch(id,body){return api(`/api/calendar/events/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({role,actor:me().org,...body})})}
function calFocus(sel){requestAnimationFrame(()=>{const el=document.querySelector(sel);if(el)el.focus()})}
document.addEventListener('click',async e=>{
 if(page!=='calendar')return;
 const t=e.target.closest('[data-cal-day],[data-cal-nav],[data-cal-form],[data-cal-cancel],[data-cal-filter]');if(!t)return;
 if(t.dataset.calDay){calSel=t.dataset.calDay;render();calFocus(`[data-cal-day="${calSel}"]`);return}
 if(t.dataset.calNav){const n=t.dataset.calNav;if(n==='today'){const x=calToday();calView={y:+x.slice(0,4),m:+x.slice(5,7)-1};calSel=x}else{const d=new Date(calView.y,calView.m+(n==='next'?1:-1),1);calView={y:d.getFullYear(),m:d.getMonth()}}render();calFocus(`[data-cal-nav="${n}"]`);return}
 if(t.dataset.calFilter){calFilter=t.dataset.calFilter;render();calFocus(`[data-cal-filter="${calFilter}"]`);return}
 if(t.hasAttribute('data-cal-form')){calForm=t.dataset.calForm;calError='';render();if(calForm)calFocus('#calTitle');return}
 if(t.dataset.calCancel){try{await calPatch(t.dataset.calCancel,{status:'Cancelled'});await refresh();toast('Meeting cancelled. No notification was sent in this demo.')}catch(err){toast(err.message,'error')}}
});
document.addEventListener('change',async e=>{
 if(page!=='calendar')return;
 const s=e.target.closest('[data-cal-status]'),d=e.target.closest('[data-cal-due]');
 if(s){try{await calPatch(s.dataset.calStatus,{status:s.value});await refresh();toast(`Task marked ${s.value.toLowerCase()}`,'success')}catch(err){toast(err.message,'error');await refresh()}}
 else if(d){if(!d.value){await refresh();return}try{await calPatch(d.dataset.calDue,{due_date:d.value});await refresh();toast('Deadline updated','success')}catch(err){toast(err.message,'error');await refresh()}}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='calForm')return;e.preventDefault();
 const f=e.target,fd=new FormData(f),fail=m=>{calError=m;const el=$('#calError');if(el)el.textContent=m};
 const payload={role,actor:me().org,kind:calForm,title:(fd.get('title')||'').trim(),description:(fd.get('description')||'').trim()};
 if(!payload.title)return fail('Enter a title.');
 if(calForm==='meeting'){payload.start_date=fd.get('start_date');payload.start_time=fd.get('start_time');payload.end_time=fd.get('end_time');payload.attendees=fd.getAll('attendees');
  if(!payload.start_date||!payload.start_time||!payload.end_time)return fail('Choose a date, start time and end time.');
  if(payload.start_date<calToday())return fail('Meetings can’t be scheduled in the past.');
  if(payload.end_time<=payload.start_time)return fail('The end time must be after the start time.')}
 else{payload.assignee_staff=fd.get('assignee_staff');payload.due_date=fd.get('due_date');payload.priority=fd.get('priority')||'Normal';
  if(!payload.assignee_staff)return fail('Choose who the work is assigned to.');
  if(!payload.due_date)return fail('Choose a completion date.');
  if(payload.due_date<calToday())return fail('The completion date can’t be in the past.')}
 try{await api('/api/calendar/events',{method:'POST',body:JSON.stringify(payload)});const made=calForm;if(made==='meeting'){calSel=payload.start_date;calView={y:+calSel.slice(0,4),m:+calSel.slice(5,7)-1}}else{calSel=payload.due_date;calView={y:+calSel.slice(0,4),m:+calSel.slice(5,7)-1}}calForm='';calError='';await refresh();toast(made==='meeting'?'Meeting scheduled. No invitation is sent in this demo.':'Work assigned. No notification is sent in this demo.','success')}
 catch(err){fail(err.message)}
});
/* ===================================================================
   BUSINESS FEATURES: notifications, cash-flow forecast, collections,
   payment run, partner scorecards, approval rule and audit pack.
   Figures come from the API, computed from stored rows. Nothing here
   emails anyone, files anything or moves money.
   =================================================================== */
const BIZ_ACCESS={cashflow:['owner','finance_manager','auditor'],collections:['owner','finance_manager','ar'],paymentRun:['ap','approver'],auditPack:['auditor','owner','finance_manager']};
const BIZ_INTERNAL=['owner','finance_manager','ar','ap','approver','auditor'];
const bizInternal=()=>BIZ_INTERNAL.includes(role);
const bizCan=p=>(BIZ_ACCESS[p]||[]).includes(role);
function bizHiddenPages(){const h=new Set();for(const[k,r]of Object.entries(BIZ_ACCESS))if(!r.includes(role))h.add(k);return h}
function bizMoreLinks(){return[['cashflow','≋','Cash-flow forecast','Weekly inflows, outflows and projected balance'],['collections','⏱','Collections','Overdue receivables, reminders and promises'],['paymentRun','⇶','Payment run','Batch approved bills and preview the cash impact'],['auditPack','⇩','Audit pack','Download the recorded trail as CSV']]}
function bizTitles(){return{cashflow:'Cash-flow forecast',collections:'Collections',paymentRun:'Payment run',auditPack:'Audit pack'}}
function bizViews(){return{cashflow:bizCashflowPage,collections:bizCollectionsPage,paymentRun:bizPaymentRunPage,auditPack:bizAuditPage}}
const biz={cache:{},stale:{},pending:{},err:{},days:60,lateBy:0,lateWho:'',editOpening:false,colBucket:'',openInv:'',tone:{},draft:{},promise:{},sel:null,strategy:'by_due',payDate:'',preview:null,previewKey:'',notif:{items:[],unread:0},notifOpen:false,notifRole:null};
const bq=()=>`org=${encodeURIComponent(me().org)}&role=${encodeURIComponent(role)}`;
const bizShort=n=>{const v=Number(n||0),a=Math.abs(v),s=v<0?'−':'';if(a>=1e7)return s+'₹'+(a/1e7).toFixed(2).replace(/\.?0+$/,'')+'Cr';if(a>=1e5)return s+'₹'+(a/1e5).toFixed(1).replace(/\.0$/,'')+'L';if(a>=1e3)return s+'₹'+Math.round(a/1e3)+'k';return s+'₹'+Math.round(a)};
const bizD=iso=>{if(!iso)return'—';const[y,m,d]=calParts(iso);return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'numeric',month:'short'})};
const bizAgo=ts=>{const t=new Date(ts);if(isNaN(t))return'';const m=Math.round((Date.now()-t)/6e4);if(m<1)return'just now';if(m<60)return m+' min ago';const h=Math.round(m/60);if(h<24)return h+'h ago';const d=Math.round(h/24);return d===1?'yesterday':d+' days ago'};
const bizBody=o=>JSON.stringify({role,actor:me().org,...o});
function bizInvalidate(){biz.stale={...biz.stale,...biz.cache};biz.cache={};biz.err={};biz.previewKey='';bizNotifLoad()}
function bizGet(key,url){
 if(key in biz.cache)return biz.cache[key];
 if(biz.err[key])return biz.stale[key]||null;
 if(!biz.pending[key])biz.pending[key]=api(url).then(d=>{biz.cache[key]=d;biz.stale[key]=d}).catch(err=>{biz.err[key]=err.message}).finally(()=>{delete biz.pending[key];if(!['landing','roles','boot'].includes(page))render()});
 return biz.stale[key]||null;
}
function bizWait(key,label){const e=biz.err[key];return `<div class="card panel biz-wait" ${e?'role="alert"':'role="status"'}>${e?`<b>${esc(label)} could not load</b><p class="subtle">${esc(e)}</p><button class="btn" data-biz="retry" data-arg="${esc(key)}">Retry</button>`:`<span class="boot-spinner" aria-hidden="true"></span><b>Loading ${esc(label.toLowerCase())}…</b>`}</div>`}
function bizNoAccess(title){return `${head('WORKSPACE',esc(title),'This view is not part of the current role.')}<div class="card panel"><p class="subtle">Switch to a role that works on this (for example the owner or the finance manager) to see it.</p>${btn('Switch demo role','roles')}</div>`}
const bizTag=(text,kind)=>`<span class="status s-${kind}">${esc(text)}</span>`;
function bizAfterRender(){
 const counts={collections:state.invoices.filter(i=>i.supplier===me().org&&['Sent','Viewed','Pending approval','Approved','Partially paid','Overdue'].includes(i.status)&&dueOffset(i.due_date)<0).length,paymentRun:state.bills.filter(b=>b.buyer===me().org&&b.status==='Approved').length};
 for(const[k,v]of Object.entries(counts)){const x=$(`#nav [data-page="${k}"] .count`);if(x)x.textContent=v}
 if(biz.notifRole!==role){biz.notifRole=role;biz.notifOpen=false;biz.notif={items:[],unread:0};bizNotifLoad()}
 bizBellRender();
 if(page==='paymentRun'&&bizCan('paymentRun'))bizRunMaybePreview();
}

/* ---- notifications ------------------------------------------------ */
function bizNotifLoad(){if(!bizInternal()||!state.businesses.length){bizBellRender();return}const want=role;fetch('/api/notifications?'+bq(),{headers:{'Content-Type':'application/json'}}).then(r=>r.ok?r.json():null).then(d=>{if(d&&want===role){biz.notif=d;bizBellRender()}}).catch(()=>{})}
function bizNotifIcon(k){return({payment:'₹',dispute:'⚑',comment:'✎',view:'◉',task:'✓',meeting:'▦',approval:'◷',invoice:'▤',reminder:'⏱',promise:'⌛',payment_run:'⇶',settings:'⚙',status:'↻'})[k]||'•'}
function bizBellRender(){
 const wrap=$('#bizBellWrap');if(!wrap)return;const show=bizInternal()&&!['landing','roles','boot','portal'].includes(page);wrap.hidden=!show;if(!show)return;
 const n=biz.notif.unread||0,c=$('#bizBellCount'),b=$('#bizBell'),p=$('#bizNotif');
 c.hidden=!n;c.textContent=n>9?'9+':String(n);b.setAttribute('aria-label',n?`Notifications, ${n} unread`:'Notifications');b.setAttribute('aria-expanded',String(biz.notifOpen));b.classList.toggle('on',biz.notifOpen);
 p.hidden=!biz.notifOpen;if(!biz.notifOpen)return;
 const items=biz.notif.items||[];
 p.innerHTML=`<div class="biz-notif-head"><b>Notifications</b><span>${n?n+' unread':'All caught up'}</span>${n?'<button class="text-link" data-biz="notif-all">Mark all read</button>':''}</div><div class="biz-notif-list">${items.map(i=>`<button type="button" class="biz-notif-item${i.read?'':' unread'}" data-biz="notif" data-arg="${esc(i.id)}"><span class="biz-notif-ico" aria-hidden="true">${bizNotifIcon(i.kind)}</span><span><b>${esc(i.title)}</b><small>${esc(i.body)}</small><em>${esc(bizAgo(i.created_at))}</em></span>${i.read?'':'<i class="biz-dot" aria-label="Unread"></i>'}</button>`).join('')||'<p class="empty">Nothing new for this role.</p>'}</div><p class="biz-notif-foot">In-app only. No email or message is sent in this demo.</p>`;
}
async function bizNotifRead(ids){try{await api('/api/notifications/read',{method:'POST',body:bizBody(ids?{ids}:{})})}catch(err){toast(err.message,'error')}bizNotifLoad()}
function bizNotifGo(n){
 const hidden=roleHiddenPages();let target=n.link_page||'overview';
 if(target==='detail'){if(invoicesForRole().some(i=>i.id===n.link_id)){selectedId=n.link_id}else target='invoices'}
 if(!(target in bizViews())&&!['detail','bills','calendar','invoices','overview','approvals','disputes'].includes(target))target='overview';
 if(hidden.has(target))target='overview';
 biz.notifOpen=false;page=target;render();window.scrollTo(0,0);
}

/* ---- cash-flow forecast ------------------------------------------- */
function bizCfCompute(d,lateBy,who){
 const t0=calDayNum(d.today),end=t0+d.days;let slipped=0;
 const items=d.items.map(x=>{if(x.type==='in'&&lateBy&&(!who||x.party_id===who)){const nd=calDayNum(x.date)+lateBy;return{...x,date:calAddDays(x.date,lateBy),shifted:true,_n:nd}}return{...x,_n:calDayNum(x.date)}});
 const kept=items.filter(x=>{if(x._n>=end){if(x.type==='in')slipped+=x.amount;return false}return true});
 const weeks=[];let bal=Number(d.opening_balance||0);
 for(let w=0;w<Math.ceil(d.days/7);w++){const s=t0+w*7,e=Math.min(s+6,end-1);const inflow=kept.filter(x=>x.type==='in'&&x._n>=s&&x._n<=e).reduce((n,x)=>n+x.amount,0),outflow=kept.filter(x=>x.type==='out'&&x._n>=s&&x._n<=e).reduce((n,x)=>n+x.amount,0);bal+=inflow-outflow;weeks.push({start:calAddDays(d.today,w*7),inflow,outflow,balance:bal})}
 const low=weeks.reduce((a,w)=>w.balance<a.balance?w:a,weeks[0]||{balance:bal,start:d.today});
 return{weeks,items:kept,slipped,low,closing:bal};
}
function bizNice(raw){const p=Math.pow(10,Math.floor(Math.log10(raw||1))),f=raw/p;return(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
function bizChart(weeks,opening){
 const W=720,H=272,L=58,R=12,T=14,B=30,n=Math.max(1,weeks.length);
 const vals=[0,opening,...weeks.flatMap(w=>[w.inflow,-w.outflow,w.balance])];let lo=Math.min(...vals),hi=Math.max(...vals);
 const step=bizNice((hi-lo)/4||1);lo=Math.floor(lo/step)*step;hi=Math.ceil(hi/step)*step;if(hi===lo)hi=lo+step;
 const y=v=>T+(hi-v)/(hi-lo)*(H-T-B),cw=(W-L-R)/n,bw=Math.max(4,Math.min(22,cw*.3)),cx=i=>L+i*cw+cw/2;
 let g='';for(let v=lo;v<=hi+step/2;v+=step){g+=`<line class="biz-grid${Math.abs(v)<1e-6?' zero':''}" x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="biz-axis" x="${L-8}" y="${(y(v)+3.5).toFixed(1)}" text-anchor="end">${bizShort(v)}</text>`}
 const bars=weeks.map((w,i)=>{const z=y(0),a=y(w.inflow),b=y(-w.outflow);return `${w.inflow?`<rect class="biz-in" x="${(cx(i)-bw-1).toFixed(1)}" y="${a.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,z-a).toFixed(1)}" rx="3"/>`:''}${w.outflow?`<rect class="biz-out" x="${(cx(i)+1).toFixed(1)}" y="${z.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,b-z).toFixed(1)}" rx="3"/>`:''}`}).join('');
 const pts=[[L,y(opening)],...weeks.map((w,i)=>[cx(i),y(w.balance)])];
 const line=`<path class="biz-line" d="${pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')}"/>`+weeks.map((w,i)=>`<circle class="biz-dotm${w.balance<0?' neg':''}" cx="${cx(i).toFixed(1)}" cy="${y(w.balance).toFixed(1)}" r="4"/>`).join('');
 const every=n>9?2:1,xl=weeks.map((w,i)=>i%every?'':`<text class="biz-axis" x="${cx(i).toFixed(1)}" y="${H-10}" text-anchor="middle">${esc(bizD(w.start))}</text>`).join('');
 const hits=weeks.map((w,i)=>`<rect class="biz-hit" x="${(L+i*cw).toFixed(1)}" y="${T}" width="${cw.toFixed(1)}" height="${H-T-B}" data-biz-wk="${i}" tabindex="0" aria-label="${esc(`Week of ${bizD(w.start)}: in ${cash(w.inflow)}, out ${cash(w.outflow)}, balance ${cash(w.balance)}`)}"/>`).join('');
 return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly inflow and outflow bars with the projected balance line">${g}${bars}${line}${xl}${hits}</svg><div class="biz-tip" hidden></div>`;
}
function bizCfSummary(d,c){
 const base=bizCfCompute(d,0,'');const who=biz.lateWho?(d.customers.find(x=>x[0]===biz.lateWho)||[])[1]:'every customer';
 if(!biz.lateBy)return `Lowest projected balance is <b>${cash(base.low.balance)}</b> in the week of ${esc(bizD(base.low.start))}. Drag the slider to test a late payment.`;
 const diff=c.low.balance-base.low.balance;
 return `If <b>${esc(who)}</b> pays <b>${biz.lateBy} day${biz.lateBy===1?'':'s'} late</b>, the lowest balance moves from ${cash(base.low.balance)} to <b class="${c.low.balance<0?'biz-neg':''}">${cash(c.low.balance)}</b> (${diff<0?'−':'+'}${cash(Math.abs(diff))}, week of ${esc(bizD(c.low.start))})${c.slipped?`; ${cash(c.slipped)} slips past the ${d.days}-day window`:''}.`;
}
function bizCfRedraw(){const d=biz.cache['cf'+biz.days]||biz.stale['cf'+biz.days];if(!d)return;const c=bizCfCompute(d,biz.lateBy,biz.lateWho);const ch=$('#bizCfChart');if(ch)ch.innerHTML=bizChart(c.weeks,Number(d.opening_balance));const s=$('#bizCfSum');if(s)s.innerHTML=bizCfSummary(d,c);const o=$('#bizLateOut');if(o)o.textContent=biz.lateBy?`${biz.lateBy} day${biz.lateBy===1?'':'s'} late`:'On time';const lm=$('#bizCfLow');if(lm){lm.textContent=cash(c.low.balance);lm.closest('.metric')?.classList.toggle('biz-warn',c.low.balance<0)}const wt=$('#bizCfWeeks');if(wt)wt.innerHTML=bizCfWeekRows(c.weeks)}
function bizCfWeekRows(weeks){return weeks.map(w=>`<tr><td>${esc(bizD(w.start))}</td><td class="num">${cash(w.inflow)}</td><td class="num">${cash(w.outflow)}</td><td class="num${w.balance<0?' biz-neg':''}">${cash(w.balance)}</td></tr>`).join('')}
function bizCashflowPage(){
 if(!bizCan('cashflow'))return bizNoAccess('Cash-flow forecast');
 const key='cf'+biz.days,d=bizGet(key,`/api/insights/cashflow?${bq()}&days=${biz.days}`);
 const toggle=`<div class="biz-seg" role="group" aria-label="Forecast window">${[30,60,90].map(n=>`<button type="button" class="biz-seg-btn${biz.days===n?' on':''}" data-biz="days" data-arg="${n}" aria-pressed="${biz.days===n}">${n} days</button>`).join('')}</div>`;
 const intro=head('MONEY · FORECAST','Cash-flow forecast','Open receivables by expected date against open payables by due date, computed from the records in this workspace.',toggle);
 if(!d)return intro+bizWait(key,'Cash-flow forecast');
 const c=bizCfCompute(d,biz.lateBy,biz.lateWho),hold=d.on_hold.reduce((n,x)=>n+x.amount,0);
 const ob=biz.editOpening&&d.can_edit?`<form class="biz-inline" id="bizOpeningForm"><label class="sr-only" for="bizOpening">Opening balance</label><input id="bizOpening" name="v" type="number" min="0" step="1000" value="${Math.round(d.opening_balance)}" required><button class="btn small primary">Save</button><button type="button" class="btn small" data-biz="opening-cancel">Cancel</button></form>`:(d.can_edit?`<button class="text-link" data-biz="opening-edit">Edit opening balance</button>`:'Set by the owner · read only');
 const opening=`<div class="card metric"><div class="metric-top"><span>Opening balance</span><span>₹</span></div><div class="value">${cash(d.opening_balance)}</div><div class="trend">${ob}</div></div>`;
 const lowWarn=c.low.balance<0;
 const top=[...c.items].sort((a,b)=>b.amount-a.amount).slice(0,10);
 const rows=top.map(x=>`<tr><td>${esc(bizD(x.date))}${x.shifted?' <span class="biz-chip">+'+biz.lateBy+'d</span>':''}</td><td>${x.type==='in'?bizTag('In','paid'):bizTag('Out','overdue')}</td><td><b>${esc(x.party)}</b><small class="biz-sub">${esc(x.id)} · ${esc(x.status)}</small></td><td><small class="biz-sub">${esc(x.basis)}</small></td><td class="num strong"><span class="biz-nw">${x.type==='in'?'+':'−'}${cash(x.amount)}</span></td></tr>`).join('');
 const whoOpts=`<option value="">All customers</option>`+d.customers.map(([id,name])=>`<option value="${esc(id)}"${biz.lateWho===id?' selected':''}>${esc(name)}</option>`).join('');
 return `${intro}<div class="metrics">${opening}${metric(`Expected in · ${d.days}d`,cash(d.totals.inflow),`${d.items.filter(x=>x.type==='in').length} open invoices`,'↘')}${metric(`Going out · ${d.days}d`,cash(d.totals.outflow),`${d.items.filter(x=>x.type==='out').length} open bills`,'↗')}<div class="card metric${lowWarn?' biz-warn':''}"><div class="metric-top"><span>Lowest projected</span><span>${lowWarn?'!':'◒'}</span></div><div class="value" id="bizCfLow">${cash(c.low.balance)}</div><div class="trend ${lowWarn?'warn':''}">Week of ${esc(bizD(c.low.start))}</div></div></div>
<section class="card panel biz-cf">${panelTitle('Weekly cash movement',`<div class="biz-legend" aria-label="Legend"><span><i class="biz-sw in"></i>Inflow</span><span><i class="biz-sw out"></i>Outflow</span><span><i class="biz-sw line"></i>Projected balance</span></div>`)}<div class="biz-chart" id="bizCfChart">${bizChart(c.weeks,Number(d.opening_balance))}</div>
<div class="biz-whatif"><div class="biz-whatif-head"><b>What if a customer pays late?</b><span class="subtle">Calculated in your browser. Nothing is saved.</span></div><div class="biz-whatif-row"><label>Customer<select id="bizLateWho">${whoOpts}</select></label><label class="biz-range">Pays <output id="bizLateOut">${biz.lateBy?biz.lateBy+' days late':'On time'}</output><input id="bizLate" type="range" min="0" max="45" step="1" value="${biz.lateBy}" aria-label="Days late"></label><button class="btn small" data-biz="late-reset">Reset</button></div><p class="biz-sum" id="bizCfSum" aria-live="polite">${bizCfSummary(d,c)}</p></div></section>
<div class="biz-two"><section class="card panel">${panelTitle('Biggest movements',`<span class="subtle">${c.items.length} in window</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Party · record</th><th>Basis</th><th class="num">Amount</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">No open items in this window.</td></tr>'}</tbody></table></div></section>
<section class="card panel">${panelTitle('Not in the forecast',`<span class="subtle">${cash(hold)}</span>`)}<div class="biz-hold">${d.on_hold.map(x=>`<div><b>${esc(x.id)} · ${esc(x.party)}</b><small>${esc(x.reason)}</small><span>${cash(x.amount)}</span></div>`).join('')||'<p class="subtle">Every open item is included.</p>'}</div><details class="biz-details"><summary>Weekly figures (table)</summary><div class="table-wrap"><table class="table"><thead><tr><th>Week of</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th></tr></thead><tbody id="bizCfWeeks">${bizCfWeekRows(c.weeks)}</tbody></table></div></details><p class="subtle biz-note">How dates are chosen: a promised date first, otherwise the due date plus the customer's average lateness from paid history (${Object.entries(d.lateness).map(([k,v])=>`${esc(k.split(' ')[0])} ${v>0?'+':''}${v}d`).join(', ')||'none yet'}). Bills use their scheduled run date or due date. Payroll, rent and taxes are not modelled and no bank feed is connected.</p></section></div>`;
}

/* ---- collections -------------------------------------------------- */
const BIZ_BUCKETS=[['current','Not yet due'],['0-30','1–30 days'],['31-60','31–60 days'],['61-90','61–90 days'],['90+','90+ days']];
function bizBucketOf(x){const l=x.days_late;return l<=0?'current':l<=30?'0-30':l<=60?'31-60':l<=90?'61-90':'90+'}
function bizPromise(p){if(!p)return '<span class="subtle">None</span>';if(p.missed)return bizTag(`Missed by ${-p.days}d`,'overdue');if(p.days===0)return bizTag('Due today','pending');return `${bizTag(`${p.days}d left`,'sent')}<small class="biz-sub">${esc(bizD(p.date))}</small>`}
function bizCollectionsPage(){
 if(!bizCan('collections'))return bizNoAccess('Collections');
 const d=bizGet('col',`/api/collections?${bq()}`);
 const intro=head('SALES · COLLECTIONS','Collections workbench','Overdue and due-soon receivables ranked by amount × days late. Reminders are recorded on the invoice; nothing is emailed.');
 if(!d)return intro+bizWait('col','Collections');
 const max=Math.max(...d.aging.map(a=>a.amount),1);
 const tiles=BIZ_BUCKETS.map(([k,label])=>{const a=d.aging.find(x=>x.bucket===k)||{amount:0,count:0};return `<button type="button" class="biz-age${biz.colBucket===k?' on':''}${k!=='current'&&a.amount?' late':''}" data-biz="bucket" data-arg="${k}" aria-pressed="${biz.colBucket===k}"><small>${label}</small><b>${cash(a.amount)}</b><span>${a.count} invoice${a.count===1?'':'s'}</span><i style="width:${Math.round(a.amount/max*100)}%"></i></button>`}).join('');
 const list=d.items.filter(x=>!biz.colBucket||bizBucketOf(x)===biz.colBucket);
 const topScore=Math.max(...d.items.map(x=>x.score),1);
 const rows=list.map((x,i)=>{const last=x.reminders[0];return `<tr class="${biz.openInv===x.id?'biz-row-on':''}"><td class="biz-rank">${x.score?i+1:'·'}</td><td><b>${esc(x.id)}</b><small class="biz-sub">${esc(x.party)}${x.disputed?' · open query':''}</small></td><td class="num strong">${cash(x.outstanding)}</td><td>${x.days_late>0?bizTag(`${x.days_late}d late`,'overdue'):bizTag(x.days_late===0?'Due today':`Due in ${-x.days_late}d`,'pending')}<span class="biz-score" title="Priority score: amount × days late"><i style="width:${Math.round(x.score/topScore*100)}%"></i></span></td><td>${bizPromise(x.promise)}</td><td>${last?`${esc(last.tone[0].toUpperCase()+last.tone.slice(1))}<small class="biz-sub">${esc(bizAgo(last.created_at))} · ${x.reminders.length} sent</small>`:'<span class="subtle">None yet</span>'}</td><td><button class="btn small${biz.openInv===x.id?' primary':''}" data-biz="compose" data-arg="${esc(x.id)}" aria-expanded="${biz.openInv===x.id}">${biz.openInv===x.id?'Composing':'Compose'}</button></td></tr>`}).join('');
 const reminders=(state.reminders||[]).filter(r=>r.org===me().org).length;
 const open=d.items.find(x=>x.id===biz.openInv);
 return `${intro}<div class="metrics">${metric('Overdue',cash(d.totals.overdue),`${d.totals.overdue_count} invoices past due`,'!',d.totals.overdue>0)}${metric('Due in 14 days',cash(d.totals.due_soon),'Worth a pre-due nudge','◷')}${metric('Open promises',d.totals.promised,'Promise-to-pay dates ahead','⌛')}${metric('Reminders logged',reminders,'Recorded in the demo, not emailed','⏱')}</div><div class="biz-aging" role="group" aria-label="Aging buckets (filter)">${tiles}</div><div class="biz-col-layout${open?' has-open':''}"><section class="card panel">${panelTitle(biz.colBucket?`Showing ${esc((BIZ_BUCKETS.find(b=>b[0]===biz.colBucket)||[])[1])}`:'Ranked worklist',biz.colBucket?'<button class="text-link" data-biz="bucket" data-arg="">Show all</button>':`<span class="subtle">${list.length} invoices</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Invoice</th><th class="num">Outstanding</th><th>Timing · priority</th><th>Promise</th><th>Last reminder</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Nothing in this bucket.</td></tr>'}</tbody></table></div></section>${open?bizComposer(open):''}</div>`;
}
function bizComposer(x){
 const tone=biz.tone[x.id]||x.suggested_tone,text=biz.draft[x.id]??x.templates[tone];
 const tones=(x.days_late>0?['gentle','firm','final']:['upcoming','gentle']).map(t=>`<button type="button" class="biz-seg-btn${t===tone?' on':''}" data-biz="tone" data-arg="${t}" aria-pressed="${t===tone}">${t==='upcoming'?'Pre-due':t[0].toUpperCase()+t.slice(1)}</button>`).join('');
 const hist=x.reminders.map(r=>`<li><b>${esc(r.tone[0].toUpperCase()+r.tone.slice(1))}</b> · ${esc(bizAgo(r.created_at))} · ${esc(staffTag(r.created_by_staff))}<small>${esc(r.body)}</small></li>`).join('');
 return `<section class="card panel biz-composer" aria-label="Reminder composer for ${esc(x.id)}">${panelTitle(`Reminder · ${esc(x.id)}`,'<button class="text-link" data-biz="compose-close">Close</button>')}<div class="biz-facts"><div><small>Customer</small><b>${esc(x.party)}</b></div><div><small>Outstanding</small><b>${cash(x.outstanding)}</b></div><div><small>Due</small><b>${esc(bizD(x.due_date))}</b></div><div><small>Pays on average</small><b>${x.customer_avg_late===null?'No paid history':x.customer_avg_late>0?`${x.customer_avg_late}d late`:`${Math.abs(x.customer_avg_late)}d early`}</b></div></div><div class="biz-seg" role="group" aria-label="Tone">${tones}</div><label class="field biz-field"><span>Message (edit freely)</span><textarea id="bizDraft" rows="5" maxlength="2000">${esc(text)}</textarea></label><div class="biz-actions"><button class="btn primary" data-biz="send" data-arg="${esc(x.id)}">Mark reminder sent (demo)</button><span class="subtle">Nothing is emailed. The reminder is stored and shown in the invoice activity.</span></div><div class="biz-promise"><b>Promise to pay</b><div class="biz-promise-row"><input type="date" id="bizPromise" min="${calToday()}" value="${esc(biz.promise[x.id]||x.promise?.date||'')}" aria-label="Promised payment date"><button class="btn small" data-biz="promise" data-arg="${esc(x.id)}">Record promise</button><span>${bizPromise(x.promise)}</span></div></div>${hist?`<div class="biz-hist"><b>Reminder history</b><ul>${hist}</ul></div>`:''}<button class="text-link" data-biz="open-invoice" data-arg="${esc(x.id)}">Open invoice and its activity →</button></section>`;
}

/* ---- payment run -------------------------------------------------- */
const BIZ_STRATS=[['by_due','By due date','Pay every selected bill, oldest due first.'],['preserve_cash','Preserve cash','Only bills due within 7 days of the pay date; defer the rest.'],['early_discount','Early discounts','Pay bills with a discount on offer, plus anything due soon.']];
function bizSettings(org){return(state.org_settings||[]).find(s=>s.org===org)||{}}
function bizRunKey(){return JSON.stringify([[...(biz.sel||[])].sort(),biz.strategy,biz.payDate])}
function bizRunMaybePreview(){const k=bizRunKey();if(k===biz.previewKey)return;biz.previewKey=k;bizRunPreview(k)}
async function bizRunPreview(k){
 const box=()=>$('#bizRunPreview');
 if(!biz.sel||!biz.sel.size){biz.preview={error:'Select at least one approved bill to preview a run.'};if(box())box().innerHTML=bizRunPreviewHtml();return}
 if(box())box().classList.add('loading');
 try{const d=await api('/api/payment-runs/preview',{method:'POST',body:bizBody({bill_ids:[...biz.sel],strategy:biz.strategy,pay_date:biz.payDate})});if(k!==biz.previewKey)return;biz.preview=d}catch(err){if(k!==biz.previewKey)return;biz.preview={error:err.message}}
 if(box()){box().classList.remove('loading');box().innerHTML=bizRunPreviewHtml()}
}
function bizRunPreviewHtml(){
 const p=biz.preview;if(!p)return '<p class="subtle">Calculating the plan…</p>';if(p.error)return `<p class="biz-error" role="alert">${esc(p.error)}</p>`;
 const rows=p.included.map(r=>`<tr><td><b>${esc(r.id)}</b><small class="biz-sub">${esc(r.vendor_name)} · ${esc(r.vendor_invoice_id)}</small></td><td>${esc(bizD(r.due_date))}${r.late?' '+bizTag('Late','overdue'):''}</td><td><small class="biz-sub">${esc(r.reason)}</small></td><td class="num">${r.discount?'−'+cash(r.discount):'—'}</td><td class="num strong">${cash(r.pay)}</td></tr>`).join('');
 const after=p.cash.after;
 return `<div class="biz-run-totals"><div><small>To pay on ${esc(bizD(p.pay_date))}</small><b>${cash(p.total)}</b></div><div><small>Discounts captured</small><b>${cash(p.discount)}</b></div><div><small>Cash available</small><b>${cash(p.cash.available)}</b><em>${cash(p.cash.opening)} balance − ${cash(p.cash.committed)} already scheduled</em></div><div class="${after<0?'neg':''}"><small>After this run</small><b>${cash(after)}</b></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Due</th><th>Why it is in</th><th class="num">Discount</th><th class="num">Pay</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">This strategy leaves every selected bill for later.</td></tr>'}</tbody></table></div>${p.deferred.length?`<div class="biz-deferred"><b>Left for a later run · ${cash(p.deferred_total)}</b>${p.deferred.map(r=>`<div><span>${esc(r.id)} · ${esc(r.vendor_name)}</span><small>${esc(r.reason)}</small><span>${cash(r.amount)}</span></div>`).join('')}</div>`:''}<div class="biz-actions"><button class="btn primary" data-biz="schedule" ${p.included.length?'':'disabled'}>Schedule batch · ${p.included.length} bill${p.included.length===1?'':'s'}</button><span class="subtle">Moves the bills to Scheduled. Simulated: no bank file is created and no money moves.</span></div>`;
}
function bizPaymentRunPage(){
 if(!bizCan('paymentRun'))return bizNoAccess('Payment run');
 const org=me().org,approved=state.bills.filter(b=>b.buyer===org&&b.status==='Approved').sort((a,b)=>a.due_date.localeCompare(b.due_date));
 if(!biz.payDate||biz.payDate<calToday())biz.payDate=calAddDays(calToday(),1);
 if(!biz.sel)biz.sel=new Set(approved.map(b=>b.id));else biz.sel=new Set([...biz.sel].filter(id=>approved.some(b=>b.id===id)));
 const set=bizSettings(org),thr=Number(set.approval_threshold||0),isApprover=role==='approver';
 const waiting=state.bills.filter(b=>b.buyer===org&&b.status==='Needs approval'),big=waiting.filter(b=>thr&&Number(b.amount)>thr);
 const runs=(state.payment_runs||[]).filter(r=>r.buyer===org),items=state.payment_run_items||[];
 const billRows=approved.map(b=>{const disc=Number(b.discount_pct||0)>0&&b.discount_by>=biz.payDate;return `<label class="biz-bill"><input type="checkbox" data-biz-bill="${esc(b.id)}" ${biz.sel.has(b.id)?'checked':''}><span><b>${esc(b.id)} · ${esc(company(b.vendor).name)}</b><small>${esc(b.description)} · due ${esc(bizD(b.due_date))}${dueOffset(b.due_date)<0?' (past due)':''}</small>${Number(b.discount_pct||0)>0?`<em class="${disc?'':'off'}">${Number(b.discount_pct)}% off if paid by ${esc(bizD(b.discount_by))}</em>`:''}</span><strong>${cash(b.amount)}</strong></label>`}).join('');
 const strat=BIZ_STRATS.map(([k,t,dsc])=>`<label class="biz-strat${biz.strategy===k?' on':''}"><input type="radio" name="bizStrat" value="${k}" ${biz.strategy===k?'checked':''}><b>${t}</b><small>${dsc}</small></label>`).join('');
 const runRows=runs.map(r=>{const its=items.filter(i=>i.run_id===r.id);return `<tr><td><b>${esc(r.id)}</b><small class="biz-sub">${esc(staffTag(r.created_by_staff))}</small></td><td>${esc((BIZ_STRATS.find(s=>s[0]===r.strategy)||[,r.strategy])[1])}</td><td>${esc(bizD(r.pay_date))}</td><td><small class="biz-sub">${its.map(i=>esc(i.bill_id)).join(', ')||r.bill_count}</small></td><td class="num strong">${cash(r.total)}</td><td>${badge(r.status)}</td><td>${r.status==='Scheduled'?`<button class="btn small soft" data-biz="run-paid" data-arg="${esc(r.id)}">Mark batch paid (demo)</button>`:'<span class="subtle">Settled</span>'}</td></tr>`}).join('');
 const rule=isApprover?`<form class="biz-inline" id="bizRuleForm"><label for="bizRule">Bills above</label><input id="bizRule" type="number" min="0" step="5000" value="${Math.round(thr)}"><button class="btn small primary">Save rule</button></form><p class="subtle">Set 0 to switch the rule off. Checked by the server whenever a bill is approved.</p>`:`<p class="biz-rule-now">${thr?`Bills above <b>${cash(thr)}</b> need ${esc(staffTag('staff_kavita'))}.`:'No approval threshold is set.'}</p><p class="subtle">Only the approver can change this rule.</p>`;
 return `${head('PURCHASES · PAYMENT RUN','Payment run','Pick approved bills, choose a strategy and preview the cash impact before you schedule a batch.')}<div class="metrics">${metric('Approved, unscheduled',approved.length,cash(approved.reduce((n,b)=>n+Number(b.amount),0)),'✓')}${metric('Scheduled runs',runs.filter(r=>r.status==='Scheduled').length,cash(runs.filter(r=>r.status==='Scheduled').reduce((n,r)=>n+Number(r.total),0))+' committed','⇶')}${metric('Bank balance (demo)',cash(set.opening_balance||0),'Seeded figure, no bank feed','₹')}${metric('Above approval limit',big.length,thr?`Waiting for the approver · limit ${bizShort(thr)}`:'No limit set','◷',big.length>0)}</div><div class="biz-run-layout"><section class="card panel">${panelTitle('1 · Approved bills',`<span class="subtle">${biz.sel.size} of ${approved.length} selected</span>`)}<div class="biz-bills">${billRows||'<p class="empty">No approved bills are waiting. Approve bills in the Bills inbox first.</p>'}</div>${approved.length?`<div class="biz-sel-actions"><button class="text-link" data-biz="sel-all">Select all</button><button class="text-link" data-biz="sel-none">Clear</button></div>`:''}</section><section class="card panel">${panelTitle('2 · Strategy and date')}<div class="biz-strats" role="radiogroup" aria-label="Strategy">${strat}</div><label class="field biz-field"><span>Pay date</span><input type="date" id="bizPayDate" min="${calToday()}" value="${esc(biz.payDate)}"></label></section></div><section class="card panel biz-preview">${panelTitle('3 · Preview',`<span class="biz-chip">${esc((BIZ_STRATS.find(s=>s[0]===biz.strategy)||[])[1]||'')}</span>`)}<div id="bizRunPreview" aria-live="polite">${bizRunPreviewHtml()}</div></section><div class="biz-two"><section class="card panel">${panelTitle('Payment runs',`<span class="subtle">${runs.length} total</span>`)}<div class="table-wrap"><table class="table"><thead><tr><th>Run</th><th>Strategy</th><th>Pay date</th><th>Bills</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>${runRows||'<tr><td colspan="7" class="empty">No runs yet.</td></tr>'}</tbody></table></div><p class="subtle biz-note">Marking a batch paid moves each bill to Paid and, for network bills, updates the supplier's shared invoice using the normal bill rules.</p></section><section class="card panel">${panelTitle('Approval rule')}${rule}${big.length?`<div class="biz-hold">${big.map(b=>`<div><b>${esc(b.id)} · ${esc(company(b.vendor).name)}</b><small>Needs the approver</small><span>${cash(b.amount)}</span></div>`).join('')}</div>`:''}</section></div>`;
}

/* ---- partner scorecards (Connections) ------------------------------ */
function bizPct(v,good=80,ok=50){if(v===null||v===undefined)return '<span class="subtle">—</span>';return bizTag(v+'%',v>=good?'paid':v>=ok?'pending':'overdue')}
function bizPartnerPanel(){
 if(!bizInternal())return '';
 const d=bizGet('partners',`/api/insights/partners?${bq()}`);
 if(!d)return `<div style="margin-top:15px">${bizWait('partners','Partner scorecards')}</div>`;
 const line=(p,side,label)=>{const s=p[side];if(!s)return '';return `<tr><td><b>${esc(p.name)}</b><small class="biz-sub">${label}</small></td><td class="num">${s.documents}<small class="biz-sub">${s.paid} paid</small></td><td class="num">${s.avg_days_to_pay===null?'<span class="subtle">—</span>':s.avg_days_to_pay+'d'}${s.avg_days_late!==null?`<small class="biz-sub">${s.avg_days_late>0?s.avg_days_late+'d late':Math.abs(s.avg_days_late)+'d early'} on avg</small>`:''}</td><td>${bizPct(s.on_time_pct)}</td><td>${s.dispute_rate===null?'<span class="subtle">—</span>':bizTag(s.dispute_rate+'%',s.dispute_rate<=10?'paid':s.dispute_rate<=25?'pending':'overdue')}</td><td class="num strong">${cash(s.open_balance)}</td></tr>`};
 const rows=d.partners.map(p=>line(p,'they_pay_you','They pay you')+line(p,'you_pay_them','You pay them')).join('');
 return `<section class="card panel biz-partners" style="margin-top:15px">${panelTitle('Partner scorecards','<span class="subtle">From recorded rows</span>')}<div class="table-wrap"><table class="table"><thead><tr><th>Partner</th><th class="num">Records</th><th class="num">Avg days to pay</th><th>On time</th><th>Dispute rate</th><th class="num">Open balance</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">No connected partners yet.</td></tr>'}</tbody></table></div><p class="subtle biz-note">Days to pay = paid date − issue date (or bill received date). On time = paid on or before the due date. Dispute rate = shared invoices that ever had a query. A dash means there is no paid history yet. No scores are estimated.</p></section>`;
}

/* ---- audit pack --------------------------------------------------- */
function bizCsvRows(text,limit){const out=[];let row=[],cell='',q=false;for(let i=0;i<text.length&&out.length<limit;i++){const ch=text[i];if(q){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')q=false;else cell+=ch}else if(ch==='"')q=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);out.push(row);row=[];cell=''}else cell+=ch}return out}
function bizAuditPage(){
 if(!bizCan('auditPack'))return bizNoAccess('Audit pack');
 const d=bizGet('audit',`/api/audit-pack?${bq()}`);
 const intro=head('COMPLIANCE · AUDIT PACK','Audit pack export','Every recorded invoice event, bill step and payment run for this business, as a CSV you can open in a spreadsheet.',d?`<button class="btn primary" data-biz="audit-dl">⇩ Download CSV</button>`:'');
 if(!d)return intro+bizWait('audit','Audit pack');
 const rows=bizCsvRows(d.csv,13),hd=rows[0]||[],body=rows.slice(1);
 const counts={};bizCsvRows(d.csv,100000).slice(1).forEach(r=>{counts[r[1]]=(counts[r[1]]||0)+1});
 return `${intro}<div class="metrics">${metric('Rows',d.rows,'Recorded events in the pack','▤')}${metric('Invoice events',counts.invoice||0,'Status, comments, reminders','◷')}${metric('Bill steps',counts.bill||0,'Receipt, approval, scheduling','▣')}${metric('Payment runs',counts.payment_run||0,'Simulated batches','⇶')}</div><section class="card panel">${panelTitle('Preview · first 12 rows',`<span class="subtle">${esc(d.filename)}</span>`)}<div class="table-wrap"><table class="table biz-audit"><thead><tr>${hd.map(h=>`<th>${esc(h.replace(/_/g,' '))}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="subtle biz-note">${esc(d.note)} Prepared for ${esc(d.generated_by)}. Cells that start with = + − @ are prefixed so spreadsheets do not run them.</p></section>`;
}
function bizDownload(name,text){const blob=new Blob([text],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}

/* ---- events ------------------------------------------------------- */
function bizTip(hit){const ch=hit.closest('.biz-chart'),tip=ch&&ch.querySelector('.biz-tip');if(!tip)return;const d=biz.cache['cf'+biz.days]||biz.stale['cf'+biz.days];if(!d)return;const c=bizCfCompute(d,biz.lateBy,biz.lateWho),w=c.weeks[+hit.dataset.bizWk];if(!w)return;const svg=ch.querySelector('svg'),r=svg.getBoundingClientRect(),hr=hit.getBoundingClientRect();tip.innerHTML=`<b>Week of ${esc(bizD(w.start))}</b><span><i class="biz-sw in"></i>In ${cash(w.inflow)}</span><span><i class="biz-sw out"></i>Out ${cash(w.outflow)}</span><span><i class="biz-sw line"></i>Balance ${cash(w.balance)}</span>`;tip.hidden=false;const x=hr.left-r.left+hr.width/2;tip.style.left=Math.max(70,Math.min(r.width-70,x))+'px';ch.querySelectorAll('.biz-hit').forEach(h=>h.classList.toggle('on',h===hit))}
document.addEventListener('pointerover',e=>{const h=e.target.closest&&e.target.closest('.biz-hit');if(h)bizTip(h)});
document.addEventListener('focusin',e=>{const h=e.target.closest&&e.target.closest('.biz-hit');if(h)bizTip(h)});
document.addEventListener('pointerout',e=>{const ch=e.target.closest&&e.target.closest('.biz-chart');if(ch&&!ch.contains(e.relatedTarget)){const t=ch.querySelector('.biz-tip');if(t)t.hidden=true;ch.querySelectorAll('.biz-hit.on').forEach(h=>h.classList.remove('on'))}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&biz.notifOpen){biz.notifOpen=false;bizBellRender();$('#bizBell')?.focus()}});
document.addEventListener('click',async e=>{
 if(e.target.closest('#bizBell')){biz.notifOpen=!biz.notifOpen;bizBellRender();if(biz.notifOpen)bizNotifLoad();return}
 if(biz.notifOpen&&!e.target.closest('#bizNotif')){biz.notifOpen=false;bizBellRender()}
 const t=e.target.closest('[data-biz]');if(!t)return;const act=t.dataset.biz,arg=t.dataset.arg||'';
 try{
  if(act==='retry'){delete biz.err[arg];render();return}
  if(act==='notif-all'){await bizNotifRead(null);return}
  if(act==='notif'){const n=(biz.notif.items||[]).find(i=>i.id===arg);if(n&&!n.read){n.read=true;biz.notif.unread=Math.max(0,biz.notif.unread-1);bizNotifRead([arg])}if(n)bizNotifGo(n);return}
  if(act==='days'){biz.days=+arg;render();return}
  if(act==='late-reset'){biz.lateBy=0;biz.lateWho='';const s=$('#bizLate'),w=$('#bizLateWho');if(s)s.value=0;if(w)w.value='';bizCfRedraw();return}
  if(act==='opening-edit'){biz.editOpening=true;render();requestAnimationFrame(()=>$('#bizOpening')?.focus());return}
  if(act==='opening-cancel'){biz.editOpening=false;render();return}
  if(act==='bucket'){biz.colBucket=biz.colBucket===arg?'':arg;render();return}
  if(act==='compose'){biz.openInv=biz.openInv===arg?'':arg;render();if(biz.openInv)requestAnimationFrame(()=>{const c=$('.biz-composer');if(c&&innerWidth<1000)c.scrollIntoView({block:'start',behavior:'smooth'});$('#bizDraft')?.focus({preventScroll:true})});return}
  if(act==='compose-close'){biz.openInv='';render();return}
  if(act==='tone'){biz.tone[biz.openInv]=arg;delete biz.draft[biz.openInv];render();return}
  if(act==='send'){const body=($('#bizDraft')?.value||'').trim();if(!body){toast('Write the reminder text first','error');return}const d=(biz.cache.col||biz.stale.col),x=d&&d.items.find(i=>i.id===arg);await api(`/api/invoices/${encodeURIComponent(arg)}/reminders`,{method:'POST',body:bizBody({tone:biz.tone[arg]||x?.suggested_tone||'gentle',body})});delete biz.draft[arg];await refresh();toast('Reminder recorded on the invoice. No email was sent.','success');return}
  if(act==='promise'){const v=$('#bizPromise')?.value;if(!v){toast('Choose the promised date','error');return}await api(`/api/invoices/${encodeURIComponent(arg)}/promise`,{method:'POST',body:bizBody({promised_date:v})});delete biz.promise[arg];await refresh();toast('Promise to pay recorded','success');return}
  if(act==='open-invoice'){selectedId=arg;page='detail';render();window.scrollTo(0,0);return}
  if(act==='sel-all'){biz.sel=new Set(state.bills.filter(b=>b.buyer===me().org&&b.status==='Approved').map(b=>b.id));render();return}
  if(act==='sel-none'){biz.sel=new Set();render();return}
  if(act==='schedule'){t.disabled=true;const d=await api('/api/payment-runs',{method:'POST',body:bizBody({bill_ids:[...biz.sel],strategy:biz.strategy,pay_date:biz.payDate})});biz.sel=null;biz.preview=null;await refresh();toast(`${d.id} scheduled for ${bizD(d.pay_date)} · ${cash(d.total)}. Simulated, no money moves.`,'success');return}
  if(act==='run-paid'){t.disabled=true;const d=await api(`/api/payment-runs/${encodeURIComponent(arg)}/mark-paid`,{method:'POST',body:bizBody({})});await refresh();toast(`${arg} marked paid (demo) · ${d.paid} bill${d.paid===1?'':'s'} updated. No money moved.`,'success');return}
  if(act==='audit-dl'){const d=biz.cache.audit||biz.stale.audit;if(d){bizDownload(d.filename,d.csv);toast(`Downloaded ${d.rows} rows`,'success')}return}
 }catch(err){t.disabled=false;toast(err.message,'error')}
});
document.addEventListener('input',e=>{
 if(e.target.id==='bizLate'){biz.lateBy=+e.target.value;bizCfRedraw()}
 if(e.target.id==='bizDraft'&&biz.openInv)biz.draft[biz.openInv]=e.target.value;
});
document.addEventListener('change',e=>{
 if(e.target.id==='bizLateWho'){biz.lateWho=e.target.value;bizCfRedraw()}
 if(e.target.id==='bizPromise'&&biz.openInv)biz.promise[biz.openInv]=e.target.value;
 const bill=e.target.closest&&e.target.closest('[data-biz-bill]');if(bill){if(bill.checked)biz.sel.add(bill.dataset.bizBill);else biz.sel.delete(bill.dataset.bizBill);const h=bill.closest('.panel')?.querySelector('.panel-head .subtle');if(h)h.textContent=`${biz.sel.size} of ${document.querySelectorAll('[data-biz-bill]').length} selected`;bizRunMaybePreview()}
 if(e.target.name==='bizStrat'){biz.strategy=e.target.value;document.querySelectorAll('.biz-strat').forEach(l=>l.classList.toggle('on',l.contains(e.target)));const c=$('.biz-preview .biz-chip');if(c)c.textContent=(BIZ_STRATS.find(s=>s[0]===biz.strategy)||[])[1]||'';bizRunMaybePreview()}
 if(e.target.id==='bizPayDate'){if(!e.target.value||e.target.value<calToday()){e.target.value=biz.payDate;toast('Choose today or a later date','error');return}biz.payDate=e.target.value;render()}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='bizOpeningForm'){e.preventDefault();try{await api('/api/settings/opening-balance',{method:'POST',body:bizBody({opening_balance:Number(e.target.v.value)})});biz.editOpening=false;await refresh();toast('Opening balance updated','success')}catch(err){toast(err.message,'error')}}
 if(e.target.id==='bizRuleForm'){e.preventDefault();try{await api('/api/settings/approval-rule',{method:'POST',body:bizBody({approval_threshold:Number($('#bizRule').value||0)})});await refresh();toast('Approval rule saved. The server checks it on every bill approval.','success')}catch(err){toast(err.message,'error')}}
});
try{render()}catch(e){console.error('Initial render failed',e)}
refresh().catch(err=>{if(['landing','roles'].includes(page)){showNetBanner('Workspace records could not load. Start server.py, then retry.');return}$('#view').innerHTML=`<div class="card panel" role="alert"><h2>Demo data is unavailable</h2><p class="subtle">${esc(err.message)} ${isLocalHost?'If you are running locally, start <code>python3 server.py</code> from the outputs folder, then retry.':'The demo data service is not connected on this site yet. Please try again later.'}</p><p><button class="btn primary" onclick="retryConnection()">Retry connection</button></p></div>`});

/* ===================================================================
   Motion layer: interactive Orb, scroll reveals, fidget interactions.
   Everything here is presentation only. It reads the same sample records
   the landing page already uses and never invents people, scores or claims.
   Reduced-motion: no auto-animation, tilt, magnet, glow or reveal; the Orb
   draws still frames and redraws when you hover, focus or drag.
   =================================================================== */
function orbData(x){return[
  {key:'invoices',glyph:'▤',title:'Invoices',figure:`${x.inv.length} open`,text:'Sent, viewed, queried and settled on one record that both businesses can see.'},
  {key:'bills',glyph:'▣',title:'Bills',figure:`${x.bills.length} open`,text:'Supplier bills are captured in one inbox and routed for a person to review.'},
  {key:'approvals',glyph:'✓',title:'Approvals',figure:`${x.action} in the network`,text:'People decide each outcome, and the decision stays attached to its record.'},
  {key:'partners',glyph:'↗',title:'Partners',figure:`${x.partners} connected`,text:'Each connection shares only the scopes both businesses have switched on.'},
  {key:'roles',glyph:'◉',title:'Role insights',figure:`${Object.keys(profiles).length} role views`,text:'Each role sees its own queues, due dates and exceptions. There are no individual scores.'}
]}

/* Reusable orb markup. Compact version drops the readout for dashboard cards. */
function orbStageMarkup(compact,dataset,extraClass){
  const d=dataset||orbData(landingSummary()),init=d[2]||d[0];
  const nodes=d.map((n,i)=>"<button type='button' class='orb-node' data-orb-i='"+i+"' aria-pressed='false'><span class='orb-glyph' aria-hidden='true'>"+n.glyph+"</span><span class='orb-label'><b>"+n.title+"</b><small>"+n.figure+"</small></span></button>").join("");
  const hint="<div class='orb-hint' aria-hidden='true'><i></i> Click an area to open its tab · Drag or shift-scroll to spin</div>";
  const readout="<div class='orb-readout' aria-live='polite'><span class='orb-readout-kick'><i></i><em data-orb-kick>THE FINANCE OPERATING SYSTEM</em></span><b data-orb-title>"+init.title+"</b><span data-orb-text>"+init.text+"</span><strong data-orb-figure>"+init.figure+"</strong></div>";
  return "<div class='orb-stage"+(compact?" orb-compact":"")+(extraClass?" "+extraClass:"")+"' role='group' aria-label='Interactive InvoiceOS orb. Drag or shift-scroll to spin it, or choose an area to open that tab.'><canvas class='orb-canvas' aria-hidden='true'></canvas><div class='orb-core' aria-hidden='true'><span class='brand-icon'>▣</span></div><div class='orb-nodes'>"+nodes+"</div>"+hint+(compact?"":readout)+"</div>";
}

(()=>{
'use strict';
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const fine=matchMedia('(pointer: fine)');
const narrowMq=matchMedia('(max-width: 700px)');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;

/* ---------------------------------------------------------------- Orb */
function startOrb(stage){
  const canvas=stage.querySelector('.orb-canvas');
  const ctx=canvas&&canvas.getContext('2d');
  if(!ctx)return;
  stage.dataset.live='1';
  const dock=stage.classList.contains('orb-dock-stage');
  const data=dock?workspaceOrbData():orbData(landingSummary());
  const nodeEls=[...stage.querySelectorAll('.orb-node')];
  const core=stage.querySelector('.orb-core');
  const readout=stage.querySelector('.orb-readout');
  const rd={kick:stage.querySelector('[data-orb-kick]'),title:stage.querySelector('[data-orb-title]'),text:stage.querySelector('[data-orb-text]'),figure:stage.querySelector('[data-orb-figure]')};
  // How the five areas relate: records are shared, approvals touch both sides, roles see all queues.
  const links=dock?data.flatMap((_,i)=>[[i,(i+1)%data.length],[i,(i+2)%data.length]]):[[0,1],[0,2],[1,2],[0,3],[1,3],[4,0],[4,1],[4,2]];
  const nbr=data.map((_,i)=>links.filter(l=>l.includes(i)).map(l=>l[0]===i?l[1]:l[0]));
  const ringDef=[{r:1.62,tilt:.62,rz:.35},{r:1.92,tilt:-.48,rz:-.55},{r:2.2,tilt:.22,rz:1.1}];
  const nodeDef=dock?data.map((_,i)=>({ring:i%3,a:.4+i*1.55,sp:i%2?-.28:.34})):[{ring:0,a:.4,sp:.34},{ring:1,a:2.5,sp:-.28},{ring:2,a:4.2,sp:.22},{ring:0,a:3.6,sp:.34},{ring:1,a:5.7,sp:-.28}];
  // Each area opens the matching workspace tab, so the orb is a navigator as well as a map.
  const jump=dock?{invoices:'invoices',bills:'bills',approvals:'approvals',partners:'connections',insights:'insights'}:{invoices:'invoices',bills:'bills',approvals:'approvals',partners:'connections',roles:'roles'};

  // Sphere points on a Fibonacci lattice, joined to their three nearest neighbours.
  const N=narrowMq.matches?240:420;
  const base=[],GA=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<N;i++){const y=1-2*(i+.5)/N,r=Math.sqrt(1-y*y),t=i*GA;base.push([Math.cos(t)*r,y,Math.sin(t)*r])}
  const edgeSet=new Set(),edges=[];
  for(let i=0;i<N;i++){
    const d=[];
    for(let j=0;j<N;j++){if(i===j)continue;const dx=base[i][0]-base[j][0],dy=base[i][1]-base[j][1],dz=base[i][2]-base[j][2];d.push([dx*dx+dy*dy+dz*dz,j])}
    d.sort((a,b)=>a[0]-b[0]);
    for(let k=0;k<3;k++){const j=d[k][1],key=i<j?i*N+j:j*N+i;if(!edgeSet.has(key)){edgeSet.add(key);edges.push([i,j])}}
  }
  const P=new Float32Array(N*4),BK=new Uint8Array(N);

  let cw=0,ch=0,dpr=1,R=100,cx=0,cy=0,narrow=narrowMq.matches,nodeW=[],nodeH=[];
  let time=0,ts=1,ryBase=.6,vel=0,pitch=.3,yawOff=0,hover=-1,pinned=-1,tour=2,shown=-1;
  let interacted=false,dragging=false,visible=true,raf=0,kickPending=false,pktTimer=.4,last=performance.now();
  const ptr={x:0,y:0,in:false};
  const waves=[],packets=[];
  const hl=data.map(()=>0),ang=nodeDef.map(n=>n.a),np=data.map(()=>({x:0,y:0,t:.5}));
  const tmp=new Float32Array(4);
  let CR=1,SR=0,CP=1,SP=0,Rb=100,F5=520;
  const ANIM=()=>!reduce.matches;

  function size(){
    const r=canvas.getBoundingClientRect();
    narrow=dock?false:narrowMq.matches;
    cw=Math.max(240,r.width);ch=Math.max(240,r.height);
    dpr=Math.min(2,window.devicePixelRatio||1);
    const W=Math.round(cw*dpr),H=Math.round(ch*dpr);
    if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H}
    R=Math.min(ch*(narrow?.3:(dock?.36:(stage.classList.contains('orb-compact')?.32:.27))),cw*(narrow?.25:(dock?.26:(stage.classList.contains('orb-compact')?.2:.185))));
    cx=cw/2;cy=narrow?ch/2:(dock?ch/2:(stage.classList.contains('orb-compact')?ch/2:(ch-96)/2+8));
    if(core){core.style.left=cx+'px';core.style.top=cy+'px'}
    nodeW=nodeEls.map(e=>e.offsetWidth||130);nodeH=nodeEls.map(e=>e.offsetHeight||40);
  }
  function proj(x,y,z,out,o){
    const x1=x*CR+z*SR,z1=-x*SR+z*CR,y1=y*CP-z1*SP,z2=y*SP+z1*CP,k=F5/(F5-z2);
    out[o]=cx+x1*k;out[o+1]=cy+y1*k;out[o+2]=k;out[o+3]=z2;
  }
  function ringPt(def,th,scale){
    const rr=def.r*R*scale,x=Math.cos(th)*rr,z=Math.sin(th)*rr;
    const ct=Math.cos(def.tilt),st=Math.sin(def.tilt),y1=-z*st,z1=z*ct,cz=Math.cos(def.rz),sz=Math.sin(def.rz);
    return[x*cz-y1*sz,x*sz+y1*cz,z1];
  }
  function addWave(x,y){waves.push({x,y,t0:time});if(waves.length>3)waves.shift();kick()}
  const qp=(a,q,b,t)=>{const u=1-t;return u*u*a+2*u*t*q+t*t*b};

  function draw(dt){
    const w=cw,h=ch,anim=ANIM();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    time+=dt;
    const act=pinned>=0?pinned:hover,focus=act>=0?act:tour;
    ts+=(((act>=0||dragging)?.15:1)-ts)*Math.min(1,dt*4);
    if(!dragging)vel*=Math.pow(.05,dt);
    ryBase+=((anim?.15*ts:0)+vel)*dt;
    pitch+=(.3+(ptr.in?(ptr.y/h-.5)*-.4:0)-pitch)*Math.min(1,dt*3);
    yawOff+=((ptr.in?(ptr.x/w-.5)*.5:0)-yawOff)*Math.min(1,dt*3);
    const ry=ryBase+yawOff;
    CR=Math.cos(ry);SR=Math.sin(ry);CP=Math.cos(pitch);SP=Math.sin(pitch);
    Rb=R*(1+(anim?.012*Math.sin(time*1.6):0));F5=Rb*5.2;

    // soft glow behind everything
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,Rb*2);
    g.addColorStop(0,'rgba(109,160,255,.24)');g.addColorStop(.45,'rgba(80,110,220,.07)');g.addColorStop(1,'rgba(8,10,14,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);

    // a faint rim so the sphere still reads as a globe between frames
    ctx.strokeStyle='rgba(155,187,255,.18)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,Rb*1.01,0,6.2832);ctx.stroke();

    // project points, then push them away from the pointer and ripples
    const RAD=90,RAD2=RAD*RAD;
    // squash + stretch while the orb is spinning, so the sphere feels elastic
    const st=clamp(vel*.02,-.26,.26)*ts,stx=1+st,sty=1-st*.55;
    for(let i=0;i<N;i++){
      const b=base[i],o=i*4;
      proj(b[0]*Rb,b[1]*Rb,b[2]*Rb,P,o);
      if(ptr.in){const dx=P[o]-ptr.x,dy=P[o+1]-ptr.y,d2=dx*dx+dy*dy;if(d2<RAD2&&d2>1){const d=Math.sqrt(d2),f=Math.pow(1-d/RAD,2)*16;P[o]+=dx/d*f;P[o+1]+=dy/d*f}}
      for(let k=0;k<waves.length;k++){
        const wv=waves[k],age=time-wv.t0;if(age>1.5)continue;
        const dx=P[o]-wv.x,dy=P[o+1]-wv.y,d=Math.sqrt(dx*dx+dy*dy)||1,diff=Math.abs(d-age*420);
        if(diff<44){const f=(1-diff/44)*16*(1-age/1.5);P[o]+=dx/d*f;P[o+1]+=dy/d*f}
      }
      P[o]=cx+(P[o]-cx)*stx;P[o+1]=cy+(P[o+1]-cy)*sty;
      const t=clamp(P[o+3]/Rb*.5+.5,0,1);BK[i]=Math.min(3,Math.floor(t*4));
    }
    while(waves.length&&time-waves[0].t0>1.5)waves.shift();

    // mesh lines, batched by depth
    ctx.lineWidth=.7;
    for(let b=0;b<4;b++){
      ctx.strokeStyle=`rgba(150,180,255,${.07+b*.075})`;ctx.beginPath();
      for(let e=0;e<edges.length;e++){const a=edges[e][0],c=edges[e][1];if(Math.max(BK[a],BK[c])!==b)continue;ctx.moveTo(P[a*4],P[a*4+1]);ctx.lineTo(P[c*4],P[c*4+1])}
      ctx.stroke();
    }
    // points
    for(let b=0;b<4;b++){
      ctx.fillStyle=`rgba(${180+b*14},${200+b*10},255,${.34+b*.22})`;ctx.beginPath();
      const s=.7+b*.5;
      for(let i=0;i<N;i++){if(BK[i]!==b)continue;ctx.moveTo(P[i*4]+s,P[i*4+1]);ctx.arc(P[i*4],P[i*4+1],s,0,6.2832)}
      ctx.fill();
    }
    // a slow scan band across the sphere
    const scan=Math.sin(time*.7)*.9;
    ctx.fillStyle='rgba(235,243,255,.9)';ctx.beginPath();
    for(let i=0;i<N;i++){if(BK[i]<2||Math.abs(base[i][1]-scan)>.05)continue;ctx.moveTo(P[i*4]+1.7,P[i*4+1]);ctx.arc(P[i*4],P[i*4+1],1.7,0,6.2832)}
    ctx.fill();

    // orbit rings
    const rs=narrow?.86:1;
    ringDef.forEach((def,ri)=>{
      const on=nodeDef[focus]&&nodeDef[focus].ring===ri;
      ctx.setLineDash([3,7]);ctx.lineWidth=1;ctx.strokeStyle=`rgba(150,182,255,${on?.38:.16})`;ctx.beginPath();
      for(let s=0;s<=64;s++){const p=ringPt(def,s/64*6.2832,rs);proj(p[0],p[1],p[2],tmp,0);const px=cx+(tmp[0]-cx)*stx,py=cy+(tmp[1]-cy)*sty;s?ctx.lineTo(px,py):ctx.moveTo(px,py)}
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // node positions
    const tg=[];
    data.forEach((_,i)=>{
      if(anim)ang[i]+=nodeDef[i].sp*dt*ts;
      const p=ringPt(ringDef[nodeDef[i].ring],ang[i],rs);proj(p[0],p[1],p[2],tmp,0);
      tmp[0]=cx+(tmp[0]-cx)*stx;tmp[1]=cy+(tmp[1]-cy)*sty;
      const t=clamp(tmp[3]/(Rb*2.3)*.5+.5,0,1),sc=.86+.24*t;
      tg.push({x:tmp[0],y:tmp[1],t,hw:(nodeW[i]||130)/2*sc,hh:(nodeH[i]||40)/2*sc});
      hl[i]=anim?hl[i]+((i===focus?1:0)-hl[i])*Math.min(1,dt*8):(i===focus?1:0);
    });
    if(!narrow){
      // keep labels from sitting on top of each other: push overlapping pairs apart along the
      // axis with the least overlap, and let the node nearer the viewer move less
      for(let it=0;it<4;it++)for(let a=0;a<tg.length;a++)for(let b=a+1;b<tg.length;b++){
        const A=tg[a],B=tg[b],ox=A.hw+B.hw+8-Math.abs(A.x-B.x),oy=A.hh+B.hh+6-Math.abs(A.y-B.y);
        if(ox>0&&oy>0){
          const wa=B.t/(A.t+B.t+.001),wb=1-wa;
          if(oy<ox){const s=A.y<B.y?-1:1;A.y+=s*oy*wa;B.y-=s*oy*wb}
          else{const s=A.x<B.x?-1:1;A.x+=s*ox*wa;B.x-=s*ox*wb}
        }
      }
      tg.forEach(q=>{q.x=clamp(q.x,q.hw+6,w-q.hw-6);q.y=clamp(q.y,q.hh+6,h-q.hh-(dock?14:108))});
    }
    tg.forEach((q,i)=>{
      const k=(!np[i].ok||!anim)?1:Math.min(1,dt*12);
      np[i].x=lerp(np[i].x,q.x,k);np[i].y=lerp(np[i].y,q.y,k);np[i].t=q.t;np[i].ok=1;
    });

    // links between areas
    links.forEach(([a,b])=>{
      const s=(a===focus||b===focus)?Math.max(hl[a],hl[b]):0,A=np[a],B=np[b];
      const qx=(A.x+B.x)/2*.65+cx*.35,qy=(A.y+B.y)/2*.65+cy*.35;
      ctx.strokeStyle=`rgba(155,187,255,${.08+.6*s})`;ctx.lineWidth=1+1.2*s;
      ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.quadraticCurveTo(qx,qy,B.x,B.y);ctx.stroke();
    });
    const fp=np[focus];
    if(fp){ctx.strokeStyle=`rgba(109,160,255,${.14+.25*hl[focus]})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(fp.x,fp.y);ctx.lineTo(cx,cy);ctx.stroke()}

    // little packets travelling along the links that touch the focused area
    if(anim){
      pktTimer-=dt;
      if(pktTimer<=0&&packets.length<9){
        pktTimer=.45+Math.random()*.6;
        const pool=links.filter(l=>l.includes(focus)),src=(pool.length&&Math.random()<.7)?pool:links;
        packets.push({l:src[Math.floor(Math.random()*src.length)],t:0,sp:.4+Math.random()*.3,rev:Math.random()<.5});
      }
      for(let k=packets.length-1;k>=0;k--){
        const pk=packets[k];pk.t+=dt*pk.sp;if(pk.t>=1){packets.splice(k,1);continue}
        const A=np[pk.l[pk.rev?1:0]],B=np[pk.l[pk.rev?0:1]],qx=(A.x+B.x)/2*.65+cx*.35,qy=(A.y+B.y)/2*.65+cy*.35;
        const px=qp(A.x,qx,B.x,pk.t),py=qp(A.y,qy,B.y,pk.t);
        ctx.fillStyle='rgba(155,187,255,.2)';ctx.beginPath();ctx.arc(px,py,5,0,6.2832);ctx.fill();
        ctx.fillStyle='rgba(225,236,255,.95)';ctx.beginPath();ctx.arc(px,py,2.1,0,6.2832);ctx.fill();
      }
    }

    // nodes: DOM labels on wide screens, labelled dots on narrow ones
    data.forEach((d,i)=>{
      const p=np[i],el=nodeEls[i];
      if(!narrow&&el){
        el.style.transform=`translate3d(${p.x}px,${p.y}px,0) translate(-50%,-50%) scale(${(.86+.24*p.t).toFixed(3)})`;
        el.style.zIndex=String(2+Math.round(p.t*10));
        el.style.opacity=(i===focus?1:.62+.38*p.t).toFixed(2);
      }else{
        ctx.fillStyle=`rgba(155,187,255,${.12+.2*hl[i]})`;ctx.beginPath();ctx.arc(p.x,p.y,10+8*hl[i],0,6.2832);ctx.fill();
        ctx.fillStyle='#e8efff';ctx.beginPath();ctx.arc(p.x,p.y,3+2*hl[i],0,6.2832);ctx.fill();
        if(i===focus){ // only the focused dot is labelled; the list below names every area
          ctx.font='600 11px "DM Sans",sans-serif';ctx.textAlign=p.x>cw*.62?'right':'left';
          ctx.fillStyle='rgba(240,245,255,.95)';ctx.fillText(d.title,p.x+(p.x>cw*.62?-14:14),p.y+4);
        }
      }
    });
  }

  function fill(i){
    const d=data[i];if(!d)return;
    const kickText=`${d.title.toUpperCase()} · CONNECTS WITH ${nbr[i].map(j=>data[j].title.toUpperCase()).join(', ')}`;
    if(rd.kick)rd.kick.textContent=kickText;
    if(rd.title)rd.title.textContent=d.title;
    if(rd.text)rd.text.textContent=d.text;
    if(rd.figure)rd.figure.textContent=d.figure;
    if(readout&&!reduce.matches){readout.classList.remove('swap');void readout.offsetWidth;readout.classList.add('swap')}
  }
  function sync(){
    const act=pinned>=0?pinned:hover,focus=act>=0?act:tour;
    if(focus!==shown){shown=focus;fill(focus)}
    nodeEls.forEach((el,i)=>{el.classList.toggle('is-on',i===focus);el.setAttribute('aria-pressed',String(i===pinned))});
  }
  function kick(){if(ANIM()||kickPending)return;kickPending=true;requestAnimationFrame(()=>{kickPending=false;if(stage.isConnected)draw(.016)})}
  function schedule(){if(!raf&&ANIM()&&stage.isConnected)raf=requestAnimationFrame(frame)}
  function frame(now){
    raf=0;
    if(!stage.isConnected){teardown();return}
    if(!visible||document.hidden)return;
    const dt=Math.max(0,Math.min(.05,(now-last)/1000));last=now;
    draw(dt);schedule();
  }

  nodeEls.forEach((el,i)=>{
    el.addEventListener('pointerenter',()=>{hover=i;interacted=true;sync();kick()});
    el.addEventListener('pointerleave',()=>{hover=-1;sync();kick()});
    el.addEventListener('focus',()=>{hover=i;interacted=true;sync();kick()});
    el.addEventListener('blur',()=>{hover=-1;sync();kick()});
    el.addEventListener('click',()=>{
      pinned=pinned===i?-1:i;interacted=true;addWave(np[i].x,np[i].y);sync();kick();
      const dest=jump[data[i]&&data[i].key];
      if(dest){stage.dataset.jumping='1';if(dock)stage.dispatchEvent(new CustomEvent('orb:nav',{bubbles:true,detail:{page:dest}}));setTimeout(()=>{if(!stage.isConnected)return;page=dest;render();try{scrollTo({top:0,behavior:reduce.matches?'auto':'smooth'})}catch(_){scrollTo(0,0)}},150)}
    });
  });
  let lastX=0,lastT=0,moved=0;
  stage.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();ptr.x=e.clientX-r.left;ptr.y=e.clientY-r.top;ptr.in=true;interacted=true;kick()});
  stage.addEventListener('pointerleave',()=>{ptr.in=false;kick()});
  canvas.addEventListener('pointerdown',e=>{dragging=true;moved=0;lastX=e.clientX;lastT=e.timeStamp;try{canvas.setPointerCapture(e.pointerId)}catch(_){}canvas.classList.add('drag');interacted=true;kick()});
  canvas.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const dx=e.clientX-lastX;moved+=Math.abs(dx);ryBase+=dx*.007;
    vel=clamp(lerp(vel,dx*.007/Math.max(.008,(e.timeStamp-lastT)/1000),.4),-8,8);
    lastX=e.clientX;lastT=e.timeStamp;kick();
  });
  const endDrag=e=>{
    if(!dragging)return;dragging=false;canvas.classList.remove('drag');
    if(moved<5){const r=canvas.getBoundingClientRect();addWave(e.clientX-r.left,e.clientY-r.top)}
    kick();
  };
  canvas.addEventListener('pointerup',endDrag);
  canvas.addEventListener('pointercancel',endDrag);
  // shift + wheel (or a horizontal trackpad swipe) spins the orb without hijacking page scroll
  canvas.addEventListener('wheel',e=>{
    if(!e.shiftKey&&Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;
    e.preventDefault();
    const d=e.shiftKey?e.deltaY:e.deltaX;
    vel=clamp(vel+d*.006,-8,8);interacted=true;kick();
  },{passive:false});

  const ro=new ResizeObserver(()=>{size();last=performance.now();draw(.016);if(ANIM())schedule()});ro.observe(canvas);
  const io=new IntersectionObserver(es=>{visible=es[0].isIntersecting;if(visible){last=performance.now();schedule();kick()}},{threshold:0});io.observe(stage);
  const onVis=()=>{if(!document.hidden){last=performance.now();schedule();kick()}};
  const onMotion=()=>{last=performance.now();schedule();kick()};
  document.addEventListener('visibilitychange',onVis);
  reduce.addEventListener('change',onMotion);
  const tourTimer=setInterval(()=>{
    if(!stage.isConnected){teardown();return}
    if(interacted||reduce.matches||!visible||document.hidden)return;
    tour=(tour+1)%data.length;sync();kick();
  },3600);
  function teardown(){
    cancelAnimationFrame(raf);raf=0;clearInterval(tourTimer);ro.disconnect();io.disconnect();
    document.removeEventListener('visibilitychange',onVis);reduce.removeEventListener('change',onMotion);
  }

  size();sync();draw(.016);schedule();
  // layout can settle a frame after insertion; repaint once so the static orb is never blank
  requestAnimationFrame(()=>{if(!stage.isConnected)return;size();draw(.016);schedule()});
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(stage.isConnected){size();kick()}});
}


/* ------------------------------------------------ workspace orb dock */
let wsOrbKey='',wsOrbOpen=false,wsOrbReady=false;

function workspaceOrbTabs(){
  const c=queueCounts(),hidden=roleHiddenPages();
  return [
    ['overview','◫','Dashboard',''],
    ['invoices','▤','Invoices',c.invoices],
    ['bills','▣','Bills',c.bills],
    ['approvals','✓','Approvals',c.approvals],
    ['disputes','⚑','Disputes',c.disputes],
    ['connections','◎','Connections',''],
    ['team','♙','Team workload',c.team],
    ['calendar','▦','Calendar',c.calendar||''],
    ['activity','◷','Activity trail',''],
    ['insights','⌁','Flow insights',''],
    ['payments','₹','Payment status',''],
    ['more','···','More','']
  ].filter(([key])=>!hidden.has(key));
}

function workspaceOrbData(){
  const c=queueCounts(),hidden=roleHiddenPages();
  const connected=state.connections.filter(x=>x.status==='Connected'&&(x.requester===me().org||x.target===me().org)).length;
  const exceptions=roleVisibleRecords().filter(r=>r.status==='Dispute'||r.status==='Overdue'||(dueOffset(r.due)!==null&&dueOffset(r.due)<0)).length;
  return [
    {key:'invoices',glyph:'▤',title:'Invoices',figure:`${c.invoices} total`,text:'Every invoice this role can see, with shared status and questions attached.'},
    {key:'bills',glyph:'▣',title:'Bills',figure:`${c.bills} total`,text:'Supplier bills captured in one inbox and routed to a person for review.'},
    {key:'approvals',glyph:'✓',title:'Approvals',figure:`${c.approvals} waiting`,text:'Records waiting for your decision. Each outcome is recorded against the business account.'},
    {key:'partners',glyph:'↗',title:'Partners',figure:`${connected} connected`,text:'Connected businesses, limited to the scopes both sides have switched on.'},
    {key:'insights',glyph:'⌁',title:'Insights',figure:`${exceptions} exceptions`,text:'Due dates and exceptions from the records this role can see. No scores or forecasts.'}
  ].filter(d=>d.key==='partners'?!hidden.has('connections'):d.key==='insights'?!hidden.has('insights'):!hidden.has(d.key));
}

function workspaceOrbMarkup(){
  const tabs=workspaceOrbTabs();
  const rail=tabs.map(([key,glyph,label,count])=>`<button type="button" class="ws-orb-tab" data-orb-tab="${key}" title="${esc(label)}"><span class="ws-orb-tab-glyph" aria-hidden="true">${glyph}</span><span class="ws-orb-tab-label">${esc(label)}</span>${count!==''?`<b>${count}</b>`:''}</button>`).join('');
  return `<button type="button" class="ws-orb-fab" id="wsOrbFab" aria-expanded="false" aria-controls="wsOrbPanel" title="Open the workspace orb (Alt+O)"><span class="ws-orb-fab-orb" aria-hidden="true"><i></i></span><span class="ws-orb-fab-copy"><b>Orb</b><small>Jump anywhere</small></span></button>
  <section class="ws-orb-panel" id="wsOrbPanel" role="dialog" aria-modal="true" aria-label="Workspace orb navigator" hidden>
    <header class="ws-orb-head"><div><small>WORKSPACE ORB</small><b>One sphere, every queue</b></div><button type="button" class="ws-orb-close" data-orb-close aria-label="Close orb">✕</button></header>
    <div class="ws-orb-body">
      <nav class="ws-orb-rail" aria-label="Workspace sections">${rail}</nav>
      <div class="ws-orb-stage-wrap">${orbStageMarkup(true,workspaceOrbData(),'orb-dock-stage')}</div>
    </div>
    <footer class="ws-orb-foot"><span><i aria-hidden="true"></i> Drag to spin · click a ring area to open that tab</span><span class="ws-orb-role">${esc(me().label)}</span></footer>
  </section>`;
}

function openOrb(focus){
  const panel=$('#wsOrbPanel'),fab=$('#wsOrbFab');
  if(!panel)return;
  clearTimeout(panel._hideTimer);
  panel.hidden=false;wsOrbOpen=true;
  requestAnimationFrame(()=>{if(wsOrbOpen)panel.classList.add('open')});
  if(fab)fab.setAttribute('aria-expanded','true');
  if(document.body)document.body.classList.add('orb-open');
  if(focus!==false)setTimeout(()=>{if(wsOrbOpen&&panel.isConnected)panel.querySelector('[data-orb-close]')?.focus()},80);
}
function closeOrb(restore){
  const panel=$('#wsOrbPanel'),fab=$('#wsOrbFab');
  if(!panel&&!fab)return;
  wsOrbOpen=false;
  if(panel){
    panel.classList.remove('open');
    clearTimeout(panel._hideTimer);
    panel._hideTimer=setTimeout(()=>{if(!wsOrbOpen&&panel.isConnected)panel.hidden=true},380);
  }
  if(fab)fab.setAttribute('aria-expanded','false');
  if(document.body)document.body.classList.remove('orb-open');
  if(restore!==false&&fab)fab.focus();
}
function toggleOrb(){wsOrbOpen?closeOrb():openOrb()}

function bindWorkspaceOrb(dock){
  const fab=$('#wsOrbFab',dock);
  if(fab)fab.addEventListener('click',toggleOrb);
  const close=$('[data-orb-close]',dock);
  if(close)close.addEventListener('click',()=>closeOrb());
  dock.querySelectorAll('[data-orb-tab]').forEach(b=>b.addEventListener('click',()=>{
    const dest=b.dataset.orbTab;closeOrb(false);page=dest;render();
    try{scrollTo({top:0,behavior:reduce.matches?'auto':'smooth'})}catch(_){scrollTo(0,0)}
  }));
  if(!dock.dataset.bound){
    dock.dataset.bound='1';
    dock.addEventListener('orb:nav',()=>closeOrb(false));
  }
}

function syncWorkspaceOrb(){
  const dock=$('#wsOrbDock');if(!dock)return;
  const hiddenPage=role==='buyer_portal'||role==='vendor_portal'||['landing','roles','boot','portal'].includes(page);
  if(hiddenPage){if(wsOrbOpen)closeOrb(false);dock.hidden=true;dock.classList.remove('visible');return}
  dock.hidden=false;dock.classList.add('visible');
  const c=queueCounts();
  const key=[role,c.invoices,c.bills,c.approvals,c.disputes,c.team,state.connections.length,state.connections.map(x=>x.status).join('')].join('|');
  if(key!==wsOrbKey){
    const wasOpen=wsOrbOpen;
    wsOrbKey=key;dock.innerHTML=workspaceOrbMarkup();bindWorkspaceOrb(dock);
    const stage=dock.querySelector('.orb-stage:not([data-live])');if(stage)startOrb(stage);
    if(wasOpen)openOrb(false);
  }
  const active=page==='detail'||page==='builder'?'invoices':page==='billUpload'?'bills':page==='network'?'connections':page;
  dock.querySelectorAll('[data-orb-tab]').forEach(b=>{
    const on=b.dataset.orbTab===active;
    b.classList.toggle('active',on);
    if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  if(wsOrbOpen&&$('#wsOrbPanel',dock)?.hidden)openOrb(false);
}

function initWorkspaceOrb(){
  if(wsOrbReady)return;wsOrbReady=true;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&wsOrbOpen){closeOrb();return}
    if(e.altKey&&(e.key==='o'||e.key==='O')){e.preventDefault();toggleOrb();return}
    if(wsOrbOpen&&e.key==='Tab'){
      const panel=$('#wsOrbPanel');if(!panel)return;
      const focusables=[...panel.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length);
      if(!focusables.length)return;
      const index=focusables.indexOf(document.activeElement);
      if(e.shiftKey){if(index<=0){e.preventDefault();focusables[focusables.length-1].focus()}}
      else if(index===-1||index===focusables.length-1){e.preventDefault();focusables[0].focus()}
    }
  });
  document.addEventListener('pointerdown',e=>{
    if(!wsOrbOpen)return;
    const dock=$('#wsOrbDock');
    if(dock&&!dock.contains(e.target))closeOrb(false);
  });
}

/* --------------------------------------------------------- count-ups */
function countUp(el){
  if(!el||el.dataset.counted||reduce.matches)return;
  const raw=el.textContent.trim(),money=raw.startsWith('₹'),num=parseFloat(raw.replace(/[^0-9.]/g,''));
  if(!isFinite(num)||num===0)return;
  el.dataset.counted='1';
  const pad=!money&&/^0\d+$/.test(raw)?raw.length:0,t0=performance.now(),dur=1100;
  const step=now=>{
    const p=Math.min(1,(now-t0)/dur),v=num*(1-Math.pow(1-p,3));
    el.textContent=money?cash(Math.round(v*100)/100):(pad?String(Math.round(v)).padStart(pad,'0'):String(Math.round(v)));
    if(p<1&&el.isConnected)requestAnimationFrame(step);else el.textContent=raw;
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------ hero headline */
function splitHero(root){
  const h=root.querySelector('.hero-copy h1');
  if(!h||h.dataset.split)return;
  h.dataset.split='1';let idx=0;
  h.querySelectorAll('.ln').forEach((ln,li)=>{
    const text=ln.textContent;ln.textContent='';ln.style.setProperty('--ln',li);
    text.split(' ').forEach((word,wi,all)=>{
      const w=document.createElement('span');w.className='w';
      [...word].forEach(c=>{const s=document.createElement('span');s.className='ch';s.style.setProperty('--i',idx++);s.textContent=c;w.appendChild(s)});
      ln.appendChild(w);if(wi<all.length-1)ln.appendChild(document.createTextNode(' '));
    });
  });
}

/* ------------------------------------------------------ scroll reveal */
function setupReveal(root){
  if(reduce.matches)return;
  const sel='.landing-v3 .l3-head,.landing-v3 .l3-stat,.landing-v3 .l3-card,.landing-v3 .l3-plain,.landing-strip>div,.landing-workflow .section-heading,.workflow-steps article,.landing-capabilities .section-heading,.capability-grid button,.landing-insights>div,.landing-idea .section-heading,.idea-card,.landing-insights-v2 .section-heading,.insights-v2-grid>*,.landing-trust .section-heading,.trust-grid>*,.landing-plainly .plainly-box,.landing-bottom,.landing-footer';
  const els=[...root.querySelectorAll(sel)];
  els.forEach(el=>{const sib=[...el.parentElement.children].filter(c=>c.matches(sel));el.style.setProperty('--d',(Math.max(0,sib.indexOf(el))%6)*90+'ms');el.classList.add('rv')});
  const io=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting)return;
    const el=e.target;io.unobserve(el);el.classList.add('rv-in');
    if(el.classList.contains('insight-panel')){el.querySelectorAll('.insight-metrics b,.insight-rows strong').forEach(countUp)}
    const delay=parseInt(el.style.getPropertyValue('--d'))||0;
    setTimeout(()=>el.classList.remove('rv','rv-in'),1400+delay);
  }),{threshold:.14,rootMargin:'0px 0px -6% 0px'});
  els.forEach(el=>io.observe(el));
}

/* ------------------------------------------------------ landing setup */
function animateLandingCounts(root){
  const stats=root.querySelectorAll('[data-count]');if(!stats.length||reduce.matches)return;
  const run=el=>{
    const target=Number(el.dataset.count)||0,money=el.hasAttribute('data-money'),t0=performance.now(),dur=950;
    const tick=now=>{const p=Math.min(1,(now-t0)/dur),v=Math.round(target*(1-Math.pow(1-p,3)));
      el.textContent=money?cash(v):String(v);
      if(p<1)requestAnimationFrame(tick)};
    requestAnimationFrame(tick)};
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){io.unobserve(e.target);run(e.target)}}),{threshold:.4});
  stats.forEach(el=>io.observe(el));
}
function enhanceLanding(root){
  if(root.dataset.fx)return;root.dataset.fx='1';
  splitHero(root);setupReveal(root);animateLandingCounts(root);if(typeof l3Init==='function')l3Init(root);
  const draftCopy=root.querySelector('[data-draft-copy]');if(draftCopy)draftCopy.dataset.original=draftCopy.textContent;
  const bar=document.createElement('div');bar.className='scroll-progress';root.prepend(bar);
  if(!reduce.matches&&fine.matches){const g=document.createElement('div');g.className='cursor-glow';root.prepend(g)}
  root.querySelectorAll('.landing-demo,.btn.large,.hero-text-link').forEach(b=>b.setAttribute('data-magnet',''));
  const links=[...root.querySelectorAll('.landing-nav nav a[href^="#"]')];
  const secs=links.map(a=>root.querySelector(a.getAttribute('href'))).filter(Boolean);
  const spy=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting)return;
    links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id));
  }),{rootMargin:'-40% 0px -55% 0px'});
  secs.forEach(s=>spy.observe(s));
  onScroll();
}

/* ----------------------------------------------- workspace page enter */
let lastPage=null;
function enhanceWorkspace(){
  const view=document.getElementById('view');
  if(!view||typeof page==='undefined'||page===lastPage)return;
  lastPage=page;
  if(reduce.matches||page==='landing'||page==='roles')return;
  view.classList.remove('enter');void view.offsetWidth;view.classList.add('enter');
  view.querySelectorAll('tbody tr').forEach((tr,i)=>tr.style.setProperty('--r',Math.min(i,14)));
  view.querySelectorAll('.metric').forEach(m=>{
    const v=[...m.children].find(c=>!c.classList.contains('metric-top')&&/^[₹\d,.\s]+$/.test(c.textContent.trim()));
    if(v)countUp(v);
  });
  setTimeout(()=>view.classList.remove('enter'),1500);
}
function onView(){
  const view=document.getElementById('view');if(!view)return;
  const landing=view.querySelector('.landing:not([data-fx])');if(landing)enhanceLanding(landing);
  const stage=view.querySelector('.orb-stage:not([data-live])');if(stage)startOrb(stage);
  syncWorkspaceOrb();
  enhanceWorkspace();
}

/* ------------------------------------------------- global interactions */
function onScroll(){
  const l=document.querySelector('.landing');if(!l)return;
  const nav=l.querySelector('.landing-nav');if(nav)nav.classList.toggle('scrolled',scrollY>24);
  const bar=l.querySelector('.scroll-progress');
  if(bar){const max=document.documentElement.scrollHeight-innerHeight;bar.style.transform=`scaleX(${max>0?clamp(scrollY/max,0,1):0})`}
}
addEventListener('scroll',onScroll,{passive:true});

let moveQueued=false,lastMove=null;
document.addEventListener('pointermove',e=>{
  lastMove=e;if(moveQueued)return;moveQueued=true;
  requestAnimationFrame(()=>{
    moveQueued=false;const ev=lastMove;if(!ev||reduce.matches||ev.pointerType==='touch')return;
    const glow=document.querySelector('.cursor-glow');
    if(glow){glow.parentElement.classList.add('glow-on');glow.style.transform=`translate3d(${ev.clientX}px,${ev.clientY}px,0)`}
    document.querySelectorAll('[data-magnet]').forEach(el=>{
      const r=el.getBoundingClientRect(),mx=r.left+r.width/2,my=r.top+r.height/2,dx=ev.clientX-mx,dy=ev.clientY-my,pad=46;
      const inside=Math.abs(dx)<r.width/2+pad&&Math.abs(dy)<r.height/2+pad;
      el.style.transform=inside?`translate(${clamp(dx*.22,-9,9).toFixed(1)}px,${clamp(dy*.3,-7,7).toFixed(1)}px)`:'';
    });
    const t=ev.target.closest&&ev.target.closest('.capability-grid button,.workflow-steps article,.insight-panel,.role-card');
    document.querySelectorAll('.tilting').forEach(el=>{if(el!==t){el.classList.remove('tilting','glare-on');el.style.transition='transform .6s cubic-bezier(.2,1.4,.4,1)';el.style.transform=''}});
    if(t){
      const r=t.getBoundingClientRect(),px=(ev.clientX-r.left)/r.width,py=(ev.clientY-r.top)/r.height,big=r.width>500,amp=t.classList.contains('role-card')?3:big?2.2:6;
      if(!t.querySelector(':scope>.glare')){const gl=document.createElement('span');gl.className='glare';gl.setAttribute('aria-hidden','true');t.appendChild(gl)}
      t.classList.add('tilting','glare-on');t.style.transition='transform .12s linear';
      t.style.transform=`perspective(900px) rotateX(${((.5-py)*amp*2).toFixed(2)}deg) rotateY(${((px-.5)*amp*2).toFixed(2)}deg)`;
      t.style.setProperty('--mx',px*100+'%');t.style.setProperty('--my',py*100+'%');
    }
  });
},{passive:true});
document.addEventListener('pointerleave',()=>{document.querySelectorAll('[data-magnet]').forEach(el=>el.style.transform='')});

document.addEventListener('pointerdown',e=>{
  if(reduce.matches)return;
  const t=e.target.closest&&e.target.closest('.btn,.role-card,.nav button');
  if(t){
    const r=t.getBoundingClientRect(),d=Math.max(r.width,r.height)*2,s=document.createElement('span');
    s.className='ripple';s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;
    t.appendChild(s);setTimeout(()=>s.remove(),650);
  }
});
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.brand-icon');
  if(b&&!reduce.matches){b.classList.remove('spin');void b.offsetWidth;b.classList.add('spin')}
});

new MutationObserver(onView).observe(document.getElementById('view'),{childList:true});
initWorkspaceOrb();
onView();
window.InvoiceOSOrb={open:openOrb,close:closeOrb,toggle:toggleOrb,isOpen:()=>wsOrbOpen};
})();


/* ==== LANDING v3 · interactions: loose-thread story, tabs, module filter, weave, draft, lock ==== */
function l3Init(root){
 if(!root||!root.classList.contains('landing-v3')||root.dataset.l3)return;root.dataset.l3='1';
 const story=root.querySelector('[data-l3-story]');
 if(story){
  const wide=matchMedia('(min-width: 980px) and (min-height: 640px)'),still=matchMedia('(prefers-reduced-motion: reduce)');
  const arts=[...story.querySelectorAll('[data-l3-step]')],n=arts.length;
  const set=i=>{
   if(story.dataset.step===String(i))return;story.dataset.step=String(i);
   arts.forEach((a,k)=>a.classList.toggle('on',k===i));
   root.querySelectorAll('.l3-dot').forEach((b,k)=>{b.classList.toggle('on',k===i);b.classList.toggle('done',k<i);if(k===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});
   story.querySelectorAll('[data-l3-tile]').forEach(t=>t.classList.toggle('lit',Number(t.dataset.l3Tile)<=i));
  };
  const onScroll=()=>{
   if(!story.isConnected){removeEventListener('scroll',onScroll);return}
   if(!story.classList.contains('is-pinned'))return;
   const total=story.offsetHeight-innerHeight;if(total<=0)return;
   const p=Math.min(.9999,Math.max(0,-story.getBoundingClientRect().top/total));set(Math.floor(p*n));
  };
  const mode=()=>{const pin=wide.matches&&!still.matches;story.classList.toggle('is-pinned',pin);if(!pin){story.dataset.step='';arts.forEach(a=>a.classList.add('on'));story.querySelectorAll('[data-l3-tile]').forEach(t=>t.classList.add('lit'))}else{story.dataset.step='';set(0);onScroll()}};
  story._l3goto=i=>{
   if(story.classList.contains('is-pinned')){const total=story.offsetHeight-innerHeight,y=story.getBoundingClientRect().top+scrollY+total*(i+.5)/n;scrollTo({top:y,behavior:still.matches?'auto':'smooth'});set(i)}
   else{const a=arts[i];if(a){a.scrollIntoView({behavior:still.matches?'auto':'smooth',block:'start'})}}
  };
  wide.addEventListener&&wide.addEventListener('change',mode);still.addEventListener&&still.addEventListener('change',mode);
  addEventListener('scroll',onScroll,{passive:true});mode();
 }
 const links=[...root.querySelectorAll('.l3-nav a[href^="#"]')],secs=links.map(a=>root.querySelector(a.getAttribute('href'))).filter(Boolean);
 if(secs.length&&'IntersectionObserver' in window){const spy=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)links.forEach(a=>{const on=a.getAttribute('href')==='#'+e.target.id;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current')})}),{rootMargin:'-40% 0px -55% 0px'});secs.forEach(s=>spy.observe(s))}
}
function l3SelectTab(btn){
 const list=btn.closest('[data-l3-tabs]');if(!list)return;const kind=list.dataset.l3Tabs,sec=list.closest('section');
 list.querySelectorAll('[role="tab"]').forEach(b=>{const on=b===btn;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;b.classList.toggle('on',on)});
 const id=kind==='case'?btn.dataset.l3Casetab:btn.dataset.l3Roletab;
 sec.querySelectorAll(kind==='case'?'[data-l3-case]':'[data-l3-rolepanel]').forEach(p=>{const on=(kind==='case'?p.dataset.l3Case:p.dataset.l3Rolepanel)===id;p.hidden=!on;if(on)animateLandingChange(p)});
}
function animateLandingChange(el){if(!el)return;el.classList.remove('landing-change');void el.offsetWidth;el.classList.add('landing-change');setTimeout(()=>el.classList.remove('landing-change'),420)}
function l3Filter(sec){
 if(!sec)return;const cat=(sec.querySelector('[data-l3-cat].on')||{dataset:{l3Cat:'all'}}).dataset.l3Cat,q=((sec.querySelector('[data-l3-q]')||{}).value||'').trim().toLowerCase();let shown=0;
 sec.querySelectorAll('[data-l3-mod]').forEach(m=>{const ok=(cat==='all'||m.dataset.l3Mod===cat)&&(!q||m.textContent.toLowerCase().includes(q));m.hidden=!ok;if(ok)shown++});
 const empty=sec.querySelector('[data-l3-empty]');if(empty)empty.hidden=shown>0;
 const live=sec.querySelector('[data-l3-count]');if(live)live.textContent=shown+(shown===1?' module shown':' modules shown');
}
const l3WeaveMods=[['invoices','Invoices'],['invoices','Overdue queue'],['approvals','Approvals'],['builder','GST on invoices'],['bills','Bills inbox'],['calendar','Calendar & work assignment'],['overview','Owner view']];
function l3UpdateWeave(sec){
 if(!sec)return;const picked=[...sec.querySelectorAll('[data-l3-weave]:checked')].map(x=>Number(x.dataset.l3Weave)).filter(i=>l3Threads[i]);
 const wefts=sec.querySelector('[data-l3-wefts]');if(wefts)wefts.innerHTML=picked.map((i,k)=>`<i style="--c:${l3Threads[i].color};--k:${k}"></i>`).join('');
 const msg=sec.querySelector('[data-l3-weave-msg]');if(msg)msg.innerHTML=picked.length?`<b>${picked.length} of ${l3Threads.length} woven.</b> These views in the demo replace them:`:'<b>Nothing woven yet.</b> Tick a loose thread and it crosses the loom.';
 const mods=sec.querySelector('[data-l3-weave-mods]');if(mods){const seen=new Set();mods.innerHTML=picked.map(i=>l3WeaveMods[i]).filter(m=>m&&!seen.has(m[1])&&seen.add(m[1])).map(m=>`<a class="l3-chip" href="/demo?page=${esc(m[0])}">${esc(m[1])} →</a>`).join('')}
}
const l3Asks=[['Mark it as paid','Refused. Payment status is recorded by a person in AP. A draft cannot change it.'],['File this month’s GSTR-1','Refused. GST returns are filed by people. Return filing is also planned, not in this demo.'],['Approve BILL-4512 for me','Refused. Approvals belong to the approver. A draft can summarise the bill, not decide it.'],['Send the reminder on WhatsApp','Refused. Nothing is sent from a draft. A person sends it, and this demo sends nothing at all.']];
document.addEventListener('click',e=>{
 const t=e.target;if(!t||!t.closest||!t.closest('.landing-v3'))return;
 const menu=t.closest('[data-l3-menu]');if(menu){const panel=document.getElementById('l3-menu'),open=menu.getAttribute('aria-expanded')!=='true';if(panel)panel.hidden=!open;menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');return}
 if(t.closest('#l3-menu a')){const panel=document.getElementById('l3-menu'),b=document.querySelector('[data-l3-menu]');if(panel)panel.hidden=true;if(b){b.setAttribute('aria-expanded','false');b.setAttribute('aria-label','Open navigation')}}
 const go=t.closest('[data-l3-goto]');if(go){const s=document.querySelector('[data-l3-story]');if(s&&s._l3goto)s._l3goto(Number(go.dataset.l3Goto));return}
 const tab=t.closest('[data-l3-casetab],[data-l3-roletab]');if(tab){l3SelectTab(tab);return}
 const cat=t.closest('[data-l3-cat]');if(cat){const sec=cat.closest('section');sec.querySelectorAll('[data-l3-cat]').forEach(b=>{const on=b===cat;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))});l3Filter(sec);return}
 const clr=t.closest('[data-l3-clear]');if(clr){const sec=clr.closest('section'),q=sec.querySelector('[data-l3-q]');if(q)q.value='';const all=sec.querySelector('[data-l3-cat="all"]');if(all)all.click();else l3Filter(sec);if(q)q.focus();return}
 const ask=t.closest('[data-l3-ask]');if(ask){const i=Number(ask.dataset.l3Ask)||0,out=ask.parentElement.querySelector('[data-l3-refusal]');if(out){out.textContent=l3Asks[i][1];out.classList.remove('landing-change');void out.offsetWidth;out.classList.add('landing-change')}const next=(i+1)%l3Asks.length;ask.dataset.l3Ask=String(next);ask.textContent=l3Asks[next][0];return}
 const lock=t.closest('[data-l3-lock-edit],[data-l3-lock-fix]');if(lock){const box=lock.closest('[data-l3-lock]'),v=box&&box.querySelector('[data-l3-verdict]');const edit=lock.hasAttribute('data-l3-lock-edit');if(v){v.textContent=edit?'Refused. A recorded amount is not rewritten. Add a correction instead, and both stay on the trail.':'Accepted as a new entry beside the original. The first amount stays visible. (Illustration: nothing is saved.)';v.dataset.tone=edit?'no':'ok'}if(box)box.classList.toggle('is-refused',edit);return}
 const draftBtn=t.closest('[data-draft-save],[data-draft-edit],[data-draft-drop]');if(draftBtn){const card=draftBtn.closest('[data-draft-card]'),copy=card&&card.querySelector('[data-draft-copy]'),edit=card&&card.querySelector('[data-draft-edit]');if(!copy)return;if(draftBtn.hasAttribute('data-draft-save')){copy.contentEditable='false';if(edit)edit.textContent='✎ Edit first';toast('Draft saved on the record · demo only, nothing sent')}else if(draftBtn.hasAttribute('data-draft-edit')){const on=copy.isContentEditable;copy.contentEditable=on?'false':'true';if(!on){copy.focus();draftBtn.textContent='✓ Done editing'}else draftBtn.textContent='✎ Edit first'}else{if(copy.dataset.original)copy.textContent=copy.dataset.original;copy.contentEditable='false';if(edit)edit.textContent='✎ Edit first';toast('Draft discarded · nothing was sent')}return}
});
document.addEventListener('keydown',e=>{
 const tab=e.target.closest&&e.target.closest('.landing-v3 [role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],i=tabs.indexOf(tab);
 const j=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 e.preventDefault();tabs[j].focus();l3SelectTab(tabs[j]);
});
document.addEventListener('change',e=>{const x=e.target.closest&&e.target.closest('[data-l3-weave]');if(x)l3UpdateWeave(x.closest('section'))});
document.addEventListener('input',e=>{const q=e.target.closest&&e.target.closest('[data-l3-q]');if(q)l3Filter(q.closest('section'))});
