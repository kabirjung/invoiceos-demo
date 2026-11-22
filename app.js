const $=(q,r=document)=>r.querySelector(q);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash=n=>{const v=Number(n||0),whole=Math.abs(v-Math.round(v))<0.005;return '₹'+v.toLocaleString('en-IN',{minimumFractionDigits:whole?0:2,maximumFractionDigits:2})};
const dateFmt=s=>{if(!s)return'—';const d=new Date(s);return isNaN(d)?s:d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
const profiles={
  owner:{label:'Owner · Northstar Studio',org:'northstar',side:'supplier',readOnly:false,create:true,approve:true,pay:true},
  finance_manager:{label:'Finance Manager · Northstar Studio',org:'northstar',side:'supplier',readOnly:false,create:true,approve:true,pay:true},
  ar:{label:'AR Accountant · Northstar Studio',org:'northstar',side:'supplier',readOnly:false,create:true,approve:false,pay:true},
  ap:{label:'AP Accountant · Meridian Retail',org:'meridian',side:'buyer',readOnly:false,create:false,approve:false,pay:false},
  approver:{label:'Approver · Meridian Retail',org:'meridian',side:'buyer',readOnly:false,create:false,approve:true,pay:false},
  buyer_portal:{label:'Buyer contact · Portal',org:'meridian',side:'buyer',readOnly:false,external:true,create:false,approve:true,pay:true},
  vendor_portal:{label:'Vendor contact · Portal',org:'northstar',side:'supplier',readOnly:true,external:true,create:false,approve:false,pay:false},
  auditor:{label:'Auditor / CA · Read only',org:'northstar',side:'supplier',readOnly:true,create:false,approve:false,pay:false}
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
const demoStartPages=new Set(['overview','invoices','bills','approvals','disputes','connections','payments','team','activity','insights','more','builder','billUpload','portal']);
let page=demoPick?'roles':demoRoute?'boot':'landing',selectedId=demoRecordId,state={businesses:[],invoices:[],comments:[],activity:[],bill_activity:[],bills:[],connections:[]},toastTimer;
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
function showNetBanner(message){const el=$('#netBanner');if(!el)return;const msg=$('#netBannerMsg');if(msg&&message)msg.textContent=message;el.classList.add('show')}
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
 let d;try{d=await r.json()}catch(error){setApiStatus('error','Demo API returned an unreadable response');throw new Error('The demo server returned an unreadable response')}
 if(!r.ok)throw new Error(d.error||'Something went wrong');
 return d;
}
async function refresh(){
 const view=$('#view');
 if(view&&!['landing','roles'].includes(page))view.setAttribute('aria-busy','true');
 try{state=await api('/api/bootstrap');if(page==='boot'){if(!me().external&&demoRecordId&&state.invoices.some(i=>i.id===demoRecordId))page='detail';else page=me().external?'portal':(demoStartPages.has(demoPageParam)?demoPageParam:'overview')}updateWorkspace();render()}
 finally{if(view)view.removeAttribute('aria-busy')}
}
function moneyFor(i){return cash(i.total)}
function toast(msg,tone='info'){const t=$('#toast');if(!t)return;t.textContent=msg;t.dataset.tone=tone;t.setAttribute('aria-live',tone==='error'?'assertive':'polite');t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),tone==='error'?4200:2800)}
$('#netRetry')?.addEventListener('click',retryConnection);
$('#netDismiss')?.addEventListener('click',hideNetBanner);
window.addEventListener('online',()=>{if($('#netBanner')?.classList.contains('show'))retryConnection()});
function updateWorkspace(){const b=company(me().org);$('#orgName').textContent=b.name;$('#orgAvatar').textContent=b.name[0];$('.workspace small').textContent='GSTIN · '+(b.gstin||'Demo profile');$('#role').value=role;}
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
    activity:visibleActivity().length
  };
}
function roleHiddenPages(){
  if(role==='buyer_portal'||role==='vendor_portal')return new Set(['overview','invoices','bills','approvals','disputes','connections','payments','team','activity','insights']);
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
const mapFeatures={people:['People & roles','Owners, AR, AP and approvers each get the work they need for their part of the finance cycle.'],records:['Shared records','An invoice and its questions, approvals and status stay together as both sides work on it.'],workflows:['Workflows','Invoices and supplier bills move through visible review steps, with a person deciding each outcome.'],network:['Partner network','Connect customers and vendors, then share documents only with the businesses involved.'],insights:['Finance visibility','Open invoices, upcoming bills and pending decisions are summarized from the workspace records.'],automation:['Less manual chasing','Status changes and shared activity are recorded in one place so teams can see what happened next.']};
const landingThreads=[
 {label:"01 · RECEIVABLES",tab:"Invoices go quiet",accent:"#00c853",honest:"Demo only",title:"An invoice leaves your desk. Then silence.",pain:"Has the buyer opened it? Is someone waiting on a correction or a decision?",with:"Share it with a connected customer. Both sides work from one invoice record, with the view and status history attached.",note:"InvoiceOS records activity in the demo. It does not send follow-up messages automatically.",recordLabel:"SUPPLIER RECORD",recordKind:"Invoice",recordStatus:"Sent",partner:"Buyer view",partnerNote:"Same invoice · review in context"},
 {label:"02 · PAYABLES",tab:"Bills arrive elsewhere",accent:"#ff6b35",honest:"Sample extraction",title:"A supplier bill arrives in a different place.",pain:"An attachment is saved, forwarded and entered again before anyone can review it.",with:"Capture a bill in the AP inbox or receive it through a connected invoice. Review the details with the record in view.",note:"Sample extraction fields are for demonstration. A person checks the bill before saving it.",recordLabel:"AP INBOX",recordKind:"Supplier bill",recordStatus:"Received",partner:"Review queue",partnerNote:"Bill details · ready for a person"},
 {label:"03 · APPROVALS",tab:"Approvals stall",accent:"#7b61ff",honest:"Human decides",title:"The decision is in someone’s inbox.",pain:"The invoice and the context needed to approve it are in different places.",with:"Route invoice and bill decisions through the finance workspace. The approver reviews the record before changing its status.",note:"Approval decisions remain with people. The demo does not approve records automatically.",recordLabel:"FINANCE REVIEW",recordKind:"Approval",recordStatus:"Needs a decision",partner:"Approver view",partnerNote:"Record context · decision history"},
 {label:"04 · DISPUTES",tab:"Queries split apart",accent:"#ff2d95",honest:"In-demo replies",title:"A query splits across email and chat.",pain:"The explanation, the disputed amount and the invoice become separate threads.",with:"Keep a buyer query and supplier reply on the shared invoice, alongside its dispute status.",note:"Replies stay inside the demo workspace. No email or WhatsApp message is sent.",recordLabel:"SHARED INVOICE",recordKind:"Buyer query",recordStatus:"In discussion",partner:"Supplier reply",partnerNote:"One conversation · same record"},
 {label:"05 · PAYMENT STATUS",tab:"Payment updates lag",accent:"#ffb800",honest:"Simulated status",title:"Payment status takes another round of chasing.",pain:"A supplier asks whether a bill was paid, and the buyer checks another spreadsheet.",with:"Record an approved bill’s status in AP and share the update on its linked invoice when that scope is enabled.",note:"Status updates are simulated. InvoiceOS does not connect to a bank or move money.",recordLabel:"BUYER AP",recordKind:"Payment status",recordStatus:"Status update",partner:"Supplier view",partnerNote:"Shared status · no transfer"},
 {label:"06 · PARTNER NETWORK",tab:"Every partner is different",accent:"#2979ff",honest:"No sign-in",title:"Every business has its own way to share.",pain:"A supplier portal can feel like one more place to check and another credential to manage.",with:"Connect a buyer or supplier and choose which invoice and payment-status details to share.",note:"The demo has no sign-in or tenant access controls; its role switcher is illustrative only.",recordLabel:"BUSINESS CONNECTION",recordKind:"Sharing scope",recordStatus:"Set by both sides",partner:"Connected partner",partnerNote:"Only enabled demo scopes are shown"},
 {label:"07 · VISIBILITY",tab:"Work hides in the queue",accent:"#00b8d9",honest:"Role-scoped",title:"It is hard to see where work is building up.",pain:"A manager has to ask around to find overdue records, approvals and open questions.",with:"Review role-visible queues, due-date pressure, exceptions and a business-account activity trail.",note:"This demo does not track individual employee assignments, attendance or productivity scores.",recordLabel:"FLOW INSIGHTS",recordKind:"Finance queue",recordStatus:"Role scoped",partner:"Activity trail",partnerNote:"Business-account events · sample data"}
];
const landingThreadViews=[
 [{label:"Invoices",page:"invoices"},{label:"Buyer view",role:"buyer_portal"}],
 [{label:"Bills inbox",page:"bills"}],
 [{label:"Approvals",page:"approvals"},{label:"Approver view",role:"approver"}],
 [{label:"Disputes",page:"disputes"},{label:"Shared invoice",page:"invoices"}],
 [{label:"Bills inbox",page:"bills"},{label:"Invoice status",page:"invoices"}],
 [{label:"Connections",page:"connections"},{label:"Buyer view",role:"buyer_portal"}],
 [{label:"Flow insights",page:"insights"},{label:"Finance queue",page:"overview"}]
];
const landingFlows=[
 {id:"invoice",tab:"Invoice shared",title:"Send an invoice. Keep the response with it.",desc:"The supplier and buyer see the same shared invoice and its status history.",steps:[["SUPPLIER","Create the invoice","Use a connected customer and check the details before sharing."],["BUYER","Open the linked invoice","The buyer sees the same invoice in their workspace."],["REVIEW","Review or query","A person can ask a question, approve or raise a dispute."],["STATUS","Follow the status","Participants see allowed changes on the shared invoice.","Scoped sharing"]],note:"Local demo only. No email, GST submission, IRN generation or money movement."},
 {id:"bill",tab:"Bill received",title:"Capture a bill. Route its review with context.",desc:"AP can work from a bill inbox and keep review steps beside the supplier record.",steps:[["AP ACCOUNTANT","Capture the bill","Add a bill to the AP inbox or receive it from a connected invoice.","Sample extraction"],["REVIEW","Check the details","Review the amount, due date and reference."],["APPROVER","Make a decision","An approver reviews the bill before changing its status."],["FOLLOW THROUGH","Keep it in view","Track the latest status from the AP queue."]],note:"Sample extraction fields are illustrative. A person checks the bill before saving it."},
 {id:"approval",tab:"Approval",title:"A person reviews the record and makes the call.",desc:"Approval requests, decisions and status changes stay attached to the finance record.",steps:[["SUBMIT","Enter the review queue","An invoice or bill waits for a person to review it."],["OPEN","Read the record","The approver sees the shared status and context."],["DECIDE","Approve or reject","The person reviewing the record chooses the outcome."],["RECORD","Keep the decision","Participants can see the resulting status."]],note:"The demo applies workflow status only; it does not initiate a payment."},
 {id:"dispute",tab:"Dispute",title:"Keep the question on the invoice it concerns.",desc:"Buyers and suppliers can exchange replies without splitting the issue across records.",steps:[["BUYER","Raise a query","The buyer opens a dispute on the shared invoice."],["SUPPLIER","Reply in context","The supplier can read the reason and respond."],["DISCUSS","Keep the thread together","Comments remain attached to that invoice.","In-demo replies"],["RESOLVE","Record the outcome","Update the dispute status when the issue is resolved."]],note:"Replies are saved in the local demo. No external message is sent."},
 {id:"payment",tab:"Payment status",title:"Share a status update, not a payment instruction.",desc:"When enabled, a buyer’s payment status update can appear on the supplier’s linked invoice.",steps:[["AP","Open the approved bill","Select the bill whose status needs to be recorded."],["UPDATE","Record the status","The demo supports status updates such as paid.","Simulated status"],["SYNC","Update the linked invoice","The supplier sees it when payment-status sharing is enabled."],["VERIFY","Review the activity","Both sides can inspect the recorded status history."]],note:"No bank connection, payment processing or money transfer is included."}
];
const landingPersonas=[
 {id:"owner",tab:"Owner",place:"FINANCE LEAD",title:"See the whole finance desk.",desc:"A role-level view of receivables, payables, partner connections and work that needs attention.",points:["Open invoices and supplier bills","Approvals, disputes and due dates","Finance activity across the workspace"],open:"Open owner view"},
 {id:"finance_manager",tab:"Finance manager",place:"FINANCE LEAD",title:"Balance the work across AR and AP.",desc:"Review the finance queues, due-date pressure, approvals and exceptions from one workspace.",points:["Receivable and payable queues","Items waiting for a decision","Role-level activity and flow insights"],open:"Open finance manager view"},
 {id:"ar",tab:"AR",place:"RECEIVABLES",title:"Move customer invoices forward.",desc:"Create invoices for connected buyers and follow views, questions and status changes.",points:["Create and share invoices","See buyer-side status updates","Reply to questions on the record"],open:"Open AR view"},
 {id:"ap",tab:"AP",place:"PAYABLES",title:"Keep supplier bills moving.",desc:"Capture bills, route approvals and record status in the AP workflow.",points:["Review the bills inbox","Route a bill for approval","Update demo payment status"],open:"Open AP view"},
 {id:"approver",tab:"Approver",place:"DECISIONS",title:"Decide with the record in front of you.",desc:"Review an invoice or bill with the shared status and conversation attached.",points:["Open items awaiting review","Approve or reject in the demo","Leave the result on the record"],open:"Open approver view"},
 {id:"buyer_portal",tab:"Buyer",place:"TRADING PARTNER",title:"Review a supplier’s shared invoice.",desc:"The buyer view shows the invoice shared by a connected supplier and lets the buyer respond in context.",points:["Open the shared invoice","Ask a question or raise a dispute","See the latest shared status"],open:"Open buyer view"},
 {id:"vendor_portal",tab:"Supplier",place:"TRADING PARTNER",title:"See the invoice from the supplier side.",desc:"Follow invoices shared with connected buyers and view the status updates available to the supplier.",points:["Review sent invoices","See buyer-side changes","Keep replies with the record"],open:"Open supplier view"}
];
function pageLanding(){
 const x=landingSummary(),latest=x.inv.slice(0,3),featured=latest[0]||null,firstThread=landingThreads[0],firstFlow=landingFlows[0],firstPersona=landingPersonas[0];
 const billValue=x.bills.reduce((n,b)=>n+Number(b.amount||0),0),invoiceId=featured?featured.id:"Sample invoice",invoiceStatus=featured?featured.status:"Ready to share",buyerName=featured?company(featured.customer).name:"Connected customer";
 const personaPoints=firstPersona.points.map(p=>"<li>"+esc(p)+"</li>").join("");
 const workflowSteps=firstFlow.steps.map((s,i)=>"<article class='workflow-step'><span class='step-index'>0"+(i+1)+"</span><span class='step-top'><small data-flow-role>"+esc(s[0])+"</small><span class='honest-chip' data-flow-honest></span></span><h3 data-flow-title>"+esc(s[1])+"</h3><p data-flow-copy>"+esc(s[2]||"")+"</p></article>").join("");
 const statCards="<div><small>OPEN RECEIVABLES</small><b>"+cash(x.value)+"</b><span>"+x.inv.length+" invoices in sample data</span></div>"+
  "<div><small>OPEN PAYABLES</small><b>"+cash(billValue)+"</b><span>"+x.bills.length+" bills in the AP view</span></div>"+
  "<div><small>NEEDS ATTENTION</small><b>"+x.action+"</b><span>Open reviews and exceptions</span></div>"+
  "<div><small>CONNECTED PARTNERS</small><b>"+x.partners+"</b><span>Businesses in this sample network</span></div>";
 const threadTabs=landingThreads.map((t,i)=>"<button type='button' role='tab' aria-selected='"+(i===0)+"' class='thread-tab"+(i===0?" active":"")+"' data-thread-tab='"+i+"'><i>"+String(i+1).padStart(2,'0')+"</i><span>"+esc(t.tab)+"</span></button>").join("");
 const weaveOptions=landingThreads.map((t,i)=>"<label class='weave-option' style='--thread-accent:"+t.accent+"'><input type='checkbox' data-weave-thread='"+i+"'><span class='weave-check' aria-hidden='true'>✓</span><span class='weave-option-copy'><b>"+esc(t.tab)+"</b><small>"+esc(t.pain)+"</small></span></label>").join("");
 const weaveWarp=Array.from({length:9},()=>"<i></i>").join("");
 const flowTabs=landingFlows.map((f,i)=>"<button type='button' role='tab' aria-selected='"+(i===0)+"' class='flow-tab"+(i===0?" active":"")+"' data-flow-tab='"+esc(f.id)+"'>"+esc(f.tab)+"</button>").join("");
 const personaTabs=landingPersonas.map((p,i)=>"<button type='button' role='tab' aria-selected='"+(i===0)+"' class='persona-tab"+(i===0?" active":"")+"' data-persona='"+esc(p.id)+"'><small>"+esc(p.place)+"</small><b>"+esc(p.tab)+"</b></button>").join("");
 const modules=[
  ["ar","INVOICING · AR","Invoices","Create and share invoices with connected customers.","invoices","↗","Sample data"],
  ["ap","PAYABLES · AP","Bills inbox","Capture supplier bills and review due dates.","bills","▤","Sample extraction"],
  ["review","HUMAN REVIEW","Approvals","Route invoice and bill decisions to an approver.","approvals","✓","Human decides"],
  ["review","SHARED EXCEPTIONS","Disputes","Keep questions and replies on the invoice.","disputes","↳","In-demo replies"],
  ["network","BUYER · SUPPLIER","Connections","Choose which records and statuses to share.","connections","◎","Scopes set by you"],
  ["review","ROLE-LEVEL VISIBILITY","Flow insights","See due dates, queues and recorded activity.","insights","⌁","Role-scoped"]
 ];
 const moduleCards=modules.map(m=>"<button class='finance-module role-card' data-domain='"+m[0]+"' data-page='"+m[4]+"'><span class='module-top'><i>"+m[5]+"</i><small>"+m[1]+"</small>"+(m[6]?"<span class='honest-chip'>"+m[6]+"</span>":"")+"</span><b>"+m[2]+"</b><p>"+m[3]+"</p><em>Open demo view <span>→</span></em></button>").join("");
 const orbMarkup=orbStageMarkup(false);
 const ribbonItems=["ONE SHARED RECORD","BUYER + SUPPLIER VIEWS","HUMAN APPROVAL","SAMPLE DATA ONLY","ROLE-SCOPED ACCESS","STATUS HISTORY KEPT","NO MONEY MOVEMENT","INVOICES · BILLS · APPROVALS"];
 const ribbonSpan=ribbonItems.map(t=>"<span>"+t+"</span><i aria-hidden='true'>◆</i>").join("");
 return [
  "<div class='landing landing-v2'>",
  "<header class='landing-nav'><a class='landing-brand' href='#top' aria-label='InvoiceOS home'><span class='brand-icon'>▣</span><span>invoiceOS</span></a><nav class='landing-nav-main' aria-label='Main menu'><a href='#threads'>The problem</a><a href='#workflow'>Workflows</a><a href='#people'>People</a><a href='#platform'>Platform</a><a href='#insights'>AI &amp; limits</a><a href='#trust'>Trust</a></nav><div class='landing-nav-actions'><button class='theme-toggle' type='button' data-theme-toggle aria-label='Switch to dark theme' aria-pressed='false' title='Switch to dark theme'><span class='theme-icon sun' aria-hidden='true'>☀</span><span class='theme-icon moon' aria-hidden='true'>☾</span></button><button class='landing-signin' data-action='roles'>Choose a role</button><button class='btn landing-demo' data-action='roles'>Open demo <span>↗</span></button><button class='landing-menu-toggle' data-landing-menu aria-expanded='false' aria-label='Open navigation'>☰</button></div><nav class='landing-mobile-menu' aria-label='Mobile menu' hidden><a href='#threads'>The problem</a><a href='#workflow'>Workflows</a><a href='#people'>People</a><a href='#platform'>Platform</a><a href='#insights'>AI &amp; limits</a><a href='#trust'>Trust</a><button data-action='roles'>Open the demo →</button></nav></header>",
  "<main id='top'>",
  "<section class='landing-hero'><div class='hero-copy'><div class='hero-kicker'><i></i> INVOICEOS · FINANCE OPERATING SYSTEM</div><h1 aria-label='The whole finance flow. One shared record.'><span class='ln'>The whole</span><span class='ln'>finance flow.</span><span class='ln accent'>One record.</span></h1><p>Invoices, supplier bills, approvals and questions move through one shared workspace for Indian B2B finance teams.</p><div class='hero-actions'><button class='btn landing-demo large' data-action='roles'>Try the demo <span>→</span></button><a class='hero-text-link' href='#threads'>Follow one finance record <span>↓</span></a></div><div class='hero-proof'><span><i>✓</i> Buyer and supplier views</span><span><i>✓</i> Human approval steps</span><span><i>✓</i> Status stays with the record</span></div><div class='hero-fineprint'>Local product demo · Sample records · No tax filing or money movement</div></div><div class='hero-visual-frame'>"+orbMarkup+"<div class='hero-visual-note'><i></i> Live sample workspace · Drag the Orb to explore the network</div></div></section>",
  "<section class='landing-thread-story' id='threads'><div class='section-heading'><div><small>THE FINANCE THREADS</small><h2>Where the work breaks apart.<br>How one record keeps it together.</h2></div><p>Follow seven everyday finance moments. Each tab shows the friction and the part InvoiceOS handles in the demo.</p></div><div class='thread-explorer' data-thread-explorer style='--thread-accent:"+firstThread.accent+"'><div class='thread-tabs' role='tablist' aria-label='Finance workflow problems'>"+threadTabs+"</div><div class='thread-layout'><article class='thread-copy'><span class='thread-count' data-thread-label>"+esc(firstThread.label)+"</span><h3 data-thread-title>"+esc(firstThread.title)+"</h3><p class='thread-pain' data-thread-pain>"+esc(firstThread.pain)+"</p><div class='thread-dash'></div><small class='thread-solution-label'>WITH INVOICEOS</small><p class='thread-solution' data-thread-solution>"+esc(firstThread.with)+"</p><p class='thread-note'><span class='honest-chip' data-thread-honest>"+esc(firstThread.honest||"")+"</span><span data-thread-note>"+esc(firstThread.note)+"</span></p></article><div class='thread-canvas' aria-label='Illustration of one invoice shared between two businesses'><div class='thread-orbit'><div class='thread-record thread-record-supplier'><div class='record-cap'><span class='record-dot'></span><span data-thread-record-label>"+esc(firstThread.recordLabel)+"</span><i>DEMO</i></div><div class='record-sheet'><small data-thread-record-kind>"+esc(firstThread.recordKind)+"</small><b>"+esc(invoiceId)+"</b><span>"+esc(buyerName)+"</span><strong>"+cash(featured?featured.total:0)+"</strong><em data-thread-record-status>"+esc(invoiceStatus)+"</em></div></div><div class='thread-linkline'><span></span><b>one shared record</b><span></span></div><div class='thread-record thread-record-buyer'><div class='record-cap'><span class='record-dot'></span><span>PARTNER VIEW</span><i>CONNECTED</i></div><div class='record-partner'><div class='partner-mark'>↔</div><div><b data-thread-partner>"+esc(firstThread.partner)+"</b><small>"+esc(firstThread.partnerNote)+"</small></div><span class='partner-check'>✓</span></div></div></div><div class='thread-canvas-caption'>Illustration from sample records · No external messages or payments</div></div></div><div class='thread-bottom'><span><i></i> Select a finance thread to follow it</span><a href='#workflow'>See the workflow ↓</a></div></div></section>",
  "<section class='landing-idea' id='idea'><div class='section-heading'><div><small>THE IDEA</small><h2>An invoice should work like<br>a shared record.</h2></div><p>Not a PDF that disappears into an inbox — one record both sides can see, question and update.</p></div><div class='idea-card'><div class='idea-mark' aria-hidden='true'>▤</div><div class='idea-copy'><b>The demo's one rule:</b><p>The supplier's invoice and the buyer's bill are the same record. So the document, the questions and the payment status stay attached to it — visible to both sides, decided by people.</p></div><div class='idea-facts'><span><i>✓</i> One record, two views</span><span><i>✓</i> Questions stay attached</span><span><i>✓</i> A person records each step</span></div></div></section>",
  "<div class='ribbon-band' aria-hidden='true'><div class='ribbon-track'>"+ribbonSpan+ribbonSpan+"</div><div class='ribbon-track ribbon-track-rev'>"+ribbonSpan+ribbonSpan+"</div></div><section class='landing-strip landing-stat-strip' id='numbers'><div class='landing-stat-card stat-green'><small>OPEN RECEIVABLES</small><b data-count='"+x.value+"' data-money='1'>"+cash(x.value)+"</b><span>"+x.inv.length+" invoices in sample data</span></div><div class='landing-stat-card stat-orange'><small>OPEN PAYABLES</small><b data-count='"+billValue+"' data-money='1'>"+cash(billValue)+"</b><span>"+x.bills.length+" bills in the AP view</span></div><div class='landing-stat-card stat-purple'><small>NEEDS ATTENTION</small><b data-count='"+x.action+"'>"+x.action+"</b><span>Open reviews and exceptions</span></div><div class='landing-stat-card stat-blue'><small>CONNECTED PARTNERS</small><b data-count='"+x.partners+"'>"+x.partners+"</b><span>Businesses in this sample network</span></div></section><p class='numbers-caption'>Numbers update from the local demo workspace. They are not live business data.</p>",
  "<section class='landing-workflow' id='workflow'><div class='section-heading'><div><small>FOLLOW ONE THREAD THROUGH FINANCE</small><h2>One event. Both sides see<br>what happens next.</h2></div><p>Choose an everyday workflow. Follow who acts and where InvoiceOS keeps the record.</p></div><div class='flow-tabs' role='tablist' aria-label='InvoiceOS workflows'>"+flowTabs+"</div><div class='flow-workspace' data-flow-workspace><div class='flow-workspace-head'><div><span class='flow-kicker' data-flow-kicker>"+esc(firstFlow.tab)+"</span><h3 data-flow-title>"+esc(firstFlow.title)+"</h3><p data-flow-description>"+esc(firstFlow.desc)+"</p></div><button class='btn landing-demo' data-action='roles'>Try this view →</button></div><div class='flow-body'><div class='workflow-steps'>"+workflowSteps+"</div><aside class='flow-poster' aria-label='Summary of the selected workflow'><div class='poster-band' aria-hidden='true'></div><small>THE WORKFLOW</small><b data-flow-poster>"+esc(firstFlow.tab)+"</b><p>Same record on both desks. Every step on the left is a demo view you can open.</p><div class='poster-meta'><span><i>⌗</i> <b data-flow-poster-steps>"+firstFlow.steps.length+" steps · sample data</b></span><span><i>◎</i> Buyer + supplier views</span><span><i>✓</i> A person decides</span></div><button class='btn landing-demo large' data-action='roles'>Open this workflow <span>→</span></button><small class='poster-fine'>Sample workspace · no sign-in · nothing external</small></aside></div><div class='flow-note'><span>i</span><small data-flow-note>"+esc(firstFlow.note)+"</small></div></div></section>",
  "<section class='landing-personas' id='people'><div class='section-heading'><div><small>WHO USES INVOICEOS</small><h2>Different roles.<br>One finance record.</h2></div><p>Pick a role to see the work that is in view, then open that demo perspective.</p></div><div class='persona-explorer' data-persona-explorer><div class='persona-tabs' role='tablist' aria-label='InvoiceOS roles'>"+personaTabs+"</div><div class='persona-panel'><div class='persona-copy'><span class='persona-place' data-persona-place>"+esc(firstPersona.place)+"</span><h3 data-persona-title>"+esc(firstPersona.title)+"</h3><p data-persona-description>"+esc(firstPersona.desc)+"</p><ul data-persona-points>"+personaPoints+"</ul><button class='btn landing-demo' data-role-pick='owner' data-persona-open>"+esc(firstPersona.open)+" →</button></div><div class='persona-illustration'><div class='persona-paper'><span>INVOICEOS · ROLE VIEW</span><i>▤</i><b data-persona-card-title>"+esc(firstPersona.tab)+" workspace</b><div class='persona-paper-row'><span>Receivables & payables</span><b>Shared</b></div><div class='persona-paper-row'><span>Actions</span><b>Role scoped</b></div><div class='persona-paper-row'><span>Decision maker</span><b>A person</b></div><small>Sample interface · No employee scorecards</small></div><div class='persona-stamp'>ONE RECORD<br>MANY VIEWS</div></div></div></div><p class='persona-note'><b>Eight demo roles in all.</b> Team insights are role-level queue and activity summaries. This demo does not track individual employee assignments, attendance or productivity scores.</p></section>",
  "<section class='landing-insights-v2' id='insights'><div class='section-heading'><div><small>WHAT THE SYSTEM DOES</small><h2>A finance system should tell you<br>exactly what it does.</h2></div><p>InvoiceOS prepares drafts and records decisions. It does not send messages, move money or file taxes — people make the calls.</p></div><div class='insights-v2-grid'><article class='draft-card' data-draft-card><div class='draft-head'><span class='honest-chip'>Draft prepared · not sent</span></div><div class='draft-body'><small class='draft-state' data-draft-state>DRAFT · A PERSON DECIDES</small><b>Payment reminder · "+esc(buyerName)+"</b><p class='draft-copy' data-draft-copy>Invoice "+esc(invoiceId)+" is past due. A short reminder could go to the buyer's contact.</p><div class='draft-actions'><button class='btn landing-demo small' data-draft-save>Save draft</button><button class='btn landing-demo small ghost' data-draft-edit>Edit first</button><button class='text-link' data-draft-drop>Discard</button></div></div><p class='draft-note'>InvoiceOS prepares the reminder draft. Sending stays with a person — and stays outside this demo.</p></article><aside class='insight-side'><div class='insight-header'><span><i></i> CLOSED IN THIS DEMO</span></div><div class='closed-chips'><span>✕ Bank transfers</span><span>✕ GST filing</span><span>✕ IRN generation</span><span>✕ Sign-in</span></div><p class='insight-copy'>Recording a payment status is not a payment. Everything here runs locally on sample records — no external services are contacted.</p></aside></div></section>",
  "<section class='landing-capabilities' id='platform'><div class='section-heading'><div><small>INVOICEOS · V1 WORKSPACE</small><h2>The finance work that belongs<br>in one place.</h2></div><p>Explore the current demo surfaces. Each card opens that view in the working app.</p></div><div class='module-tools'><div class='module-filters' role='group' aria-label='Filter finance workflows'><button class='module-filter active' aria-pressed='true' data-domain-filter='all'>All flows <span>6</span></button><button class='module-filter' aria-pressed='false' data-domain-filter='ar'>AR <span>1</span></button><button class='module-filter' aria-pressed='false' data-domain-filter='ap'>AP <span>1</span></button><button class='module-filter' aria-pressed='false' data-domain-filter='network'>Network <span>1</span></button><button class='module-filter' aria-pressed='false' data-domain-filter='review'>Review & insights <span>3</span></button></div><input class='module-search' data-module-search type='search' placeholder='Search the demo views…' aria-label='Search demo views'></div><div class='capability-grid finance-module-grid'>"+moduleCards+"</div><p class='module-empty' data-module-empty hidden>No demo view matches that search.</p><p class='module-caption'>V1 focus: invoicing, AR/AP and the shared buyer–supplier record. CRM, projects, payroll and inventory are outside this demo.</p></section>",
  "<section class='landing-thread-picker' id='weave'><div class='section-heading'><div><small>WHERE TO BEGIN</small><h2>Which finance threads still<br>run by hand?</h2></div><p>Tick the work your team still chases across inboxes and spreadsheets. See the existing InvoiceOS views that bring those records together.</p></div><div class='thread-weaver' data-thread-weaver><div class='weave-options' role='group' aria-label='Finance threads to bring together'>"+weaveOptions+"</div><div class='weave-result' aria-live='polite'><div class='weave-illustration' aria-label='Illustration of selected finance workflows being woven together'><div class='weave-loom'><div class='loom-warp' aria-hidden='true'>"+weaveWarp+"</div><div class='loom-weft' data-weave-art aria-hidden='true'></div><div class='loom-empty' data-weave-empty>Tick a finance thread to weave it in.</div></div><div class='weave-visual-caption' data-weave-visual-caption>YOUR FINANCE WORKFLOW · SAMPLE VIEWS</div></div><div class='weave-summary'><div class='weave-counter'><small>YOUR FINANCE THREADS</small><b data-weave-count>0 of 7 woven</b></div><h3 data-weave-title>Start with the work that slips between tools.</h3><p data-weave-copy>Select a thread above. InvoiceOS will connect it to the finance views already in this demo.</p><div class='weave-areas'><small>EXISTING VIEWS IN THE WEAVE</small><div class='weave-modules' data-weave-modules><span class='weave-placeholder'>Your selected views will appear here.</span></div></div><p class='weave-note'>Illustration only · sample records · no external messages, GST filing or money movement</p></div></div></div></section>",
  "<section class='landing-trust' id='trust'><div class='section-heading'><div><small>THE RECORD YOU CAN AUDIT</small><h2>What is recorded<br>stays recorded.</h2></div><p>Every demo change is recorded with who made it and when. Try to rewrite history below — the record refuses.</p></div><div class='trust-grid'><div class='guardrail-grid'><article><b>01</b><strong>People approve</strong><span>Invoice and bill outcomes stay with a person.</span></article><article><b>02</b><strong>Scope is visible</strong><span>Connections control which records and status details are shared.</span></article><article><b>03</b><strong>Status only</strong><span>Recording a payment status does not move money.</span></article><article><b>04</b><strong>Sample environment</strong><span>No GST submission, IRN generation, bank link or sign-in is active.</span></article></div><div class='lock-demo' data-lock-demo><div class='lock-head'><span class='honest-chip'>Append-only demo</span><small>LIVE RECORD · SAMPLE EVENT</small></div><div class='lock-row'><span class='lock-badge'>0042</span><div class='lock-copy'><b>Status set to Paid</b><small>finance_manager · today 14:05 · recorded in the demo</small></div><div class='lock-actions'><button class='btn landing-demo small ghost' data-lock-edit>Edit</button><button class='btn landing-demo small ghost' data-lock-del>Delete</button></div></div><p class='lock-verdict' data-lock-verdict hidden></p></div></div></section>",
  "<section class='landing-start' id='start'><div class='section-heading'><div><small>GETTING STARTED</small><h2>Three steps into the finance flow.</h2></div><p>Start with a role, connect a business and move one invoice or bill through review.</p></div><div class='start-grid'><article><b>1</b><small>CHOOSE A VIEW</small><h3>Start with your role.</h3><p>Open the owner, AR, AP, approver or partner perspective in the sample workspace.</p></article><article><b>2</b><small>CONNECT A BUSINESS</small><h3>Set the sharing scope.</h3><p>Choose which invoice and payment-status details the connected business can see.</p></article><article><b>3</b><small>FOLLOW THE RECORD</small><h3>Review the next step.</h3><p>Send, receive, approve or discuss an invoice without leaving its context.</p></article></div></section>",
  "<section class='landing-plainly' id='plainly'><div class='plainly-box'><div><small>STATED PLAINLY</small><b>This is a local product demo.</b></div><span>Sample businesses and invoices</span><span>No real tax documents</span><span>No money movement</span><span>Role switcher is not access control</span></div></section>",
  "<section class='landing-bottom' id='tour'><div class='bottom-mark'>▤</div><small>YOUR FINANCE TEAM · YOUR TRADING PARTNERS</small><h2>The whole finance flow,<br>woven into one workspace.</h2><p>See a buyer and supplier work from the same invoice record.</p><div class='bottom-actions'><button class='btn landing-demo' data-action='roles'>Try the demo <span>→</span></button><a href='#threads' class='bottom-link'>Follow the story ↑</a></div><div class='bottom-ribbons' aria-hidden='true'><i></i><i></i><i></i></div></section>",
  "</main><footer class='landing-footer'><div class='footer-cols'><div class='footer-brand'><a class='landing-brand' href='#top'><span class='brand-icon'>▣</span><span>invoiceOS</span></a><p>Finance workspace for Indian B2B businesses — one shared record between a business and its trading partners.</p><span class='footer-fine'>Local demo · Sample records · Not a production service</span></div><div class='footer-col'><small>DEMO VIEWS</small><button data-page='invoices'>Invoices</button><button data-page='bills'>Bills inbox</button><button data-page='approvals'>Approvals</button><button data-page='disputes'>Disputes</button><button data-page='connections'>Connections</button><button data-page='insights'>Flow insights</button></div><div class='footer-col'><small>THE STORY</small><button data-action='roles'>Choose a role</button><button data-action='landing'>Back to overview</button><a href='#threads'>The finance threads</a><a href='#insights'>AI &amp; limits</a><a href='#trust'>The audit trail</a></div></div><div class='footer-base'><span>© 2026 InvoiceOS · product demo</span><span>Sample data only — no GST filing, no money movement, no sign-in</span></div></footer></div>"
 ].join("");
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
 const greeting=({owner:'Arjun',finance_manager:'Meera',ar:'Arjun',ap:'Riya',approver:'Kavita',buyer_portal:'Riya',vendor_portal:'Northstar team',auditor:'Audit team'})[role]||'Arjun';
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

function detailPage(){const i=state.invoices.find(x=>x.id===selectedId);if(!i)return invoicesPage();const other=company(me().side==='supplier'?i.customer:i.supplier),comments=state.comments.filter(c=>c.invoice_id===i.id),events=state.activity.filter(a=>a.invoice_id===i.id),tax=taxBreakdown(i.supplier_gstin,i.customer_gstin,i.qty*i.rate,i.tax);const actions=[];if(!me().readOnly&&!me().external){if(i.status==='Sent'&&me().side==='supplier')actions.push(btn('Submit for approval','status|'+i.id+'|Pending approval','soft'));if(['Sent','Viewed'].includes(i.status)&&me().side==='buyer'&&role==='ap')actions.push(btn('Submit for approval','status|'+i.id+'|Pending approval','soft'));if(['Sent','Viewed','Pending approval'].includes(i.status)&&me().side==='buyer'&&me().approve)actions.push(btn('Approve invoice','status|'+i.id+'|Approved','soft'),btn('Reject','status|'+i.id+'|Rejected'));if(['Approved','Partially paid','Overdue'].includes(i.status)&&me().pay&&isConnected(i.supplier,i.customer,'share_payment_status'))actions.push(btn('Record payment','status|'+i.id+'|Paid'));if(!['Dispute','Resolved','Paid'].includes(i.status))actions.push(btn('Raise a query','showDispute'))}else if(role==='buyer_portal'&&['Sent','Viewed'].includes(i.status))actions.push(btn('Approve','status|'+i.id+'|Approved','soft'),btn('Ask a question','showDispute'));if(i.status==='Dispute'&&!me().readOnly)actions.push(btn('Resolve query','status|'+i.id+'|Resolved','soft'));return `${head('SHARED INVOICE',esc(i.id),`${esc(other.name)} · Issued ${dateFmt(i.issue_date)} · Due ${dateFmt(i.due_date)}`,btn('← Invoices','invoices'))}<div class="detail-layout"><div><div class="card invoice-hero"><div style="display:flex;justify-content:space-between;align-items:start"><div><div class="invoice-number">${esc(i.id)}</div><p class="subtle">${me().side==='supplier'?'Billed to':'From'} <b>${esc(other.name)}</b></p></div>${badge(i.status)}</div><div class="invoice-meta"><div><label>Issue date</label><strong>${dateFmt(i.issue_date)}</strong></div><div><label>Due date</label><strong>${dateFmt(i.due_date)}</strong></div><div><label>PO reference</label><strong>${esc(i.po_number||'—')}</strong></div></div><div class="amount-box"><span>Total invoice value</span><strong>${moneyFor(i)}</strong></div><div class="invoice-item"><div><b>${esc(i.description)}</b><small>${Number(i.qty)} unit · ${cash(i.rate)} · GST ${Number(i.tax)}%</small></div><div><b>${moneyFor(i)}</b></div></div><div class="tax-split"><span>Taxable value <b>${cash(i.qty*i.rate)}</b></span>${tax.map(t=>`<span>${t.label} <b>${cash(t.value)}</b></span>`).join('')}<span>Total <b>${moneyFor(i)}</b></span></div><div class="shared-object"><b>Shared with ${esc(other.name)}</b><small>Only this invoice and its activity are shared. Other records stay private.</small></div><div class="actions" style="margin-top:16px">${actions.join('')}${btn('Open '+portalLabel().toLowerCase()+' ↗','portal','')}</div><form id="disputeForm" class="field" style="display:none;margin-top:16px"><label>What needs to be resolved?</label><textarea name="reason" required placeholder="Wrong PO, amount, quantity, tax or duplicate"></textarea><button class="btn primary" style="margin-top:8px">Send query</button></form></div><div class="card panel" style="margin-top:15px">${panelTitle('Shared conversation')}<div>${comments.map(c=>`<div class="activity-item"><div class="activity-copy"><b>${esc(company(c.actor).name)}</b><small>${dateFmt(c.created_at)}</small><div>${esc(c.body)}</div></div></div>`).join('')||'<p class="subtle">No replies yet.</p>'}</div>${!me().readOnly?`<form id="commentForm" class="field"><label>Reply</label><textarea name="body" required placeholder="Add a reply to this shared invoice"></textarea><button class="btn soft" style="margin-top:8px">Send reply</button></form>`:''}</div></div><div class="card timeline"><h2>Status timeline</h2>${events.map(a=>`<div class="timeline-item"><div class="dot">✓</div><div class="timeline-copy"><b>${esc(a.action)}</b><small>${dateFmt(a.created_at)} · ${esc(company(a.actor).name)}</small>${a.detail?`<small>${esc(a.detail)}</small>`:''}</div></div>`).join('')}<div class="timeline-item"><div class="dot">◎</div><div class="timeline-copy"><b>Shared object</b><small>Both companies see the same invoice status and conversation.</small></div></div></div></div>`}
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
 return `${head('NETWORK · CONNECTIONS','Connected businesses','Invite a trading partner and choose exactly what your companies share.',me().readOnly?'':btn('+ Invite business','invite','primary'))}<div class="metrics">${metric('Connected',connected.length,'Active trading links','◎')}${metric('Pending',pending.length,'Waiting for acceptance','◷',pending.length>0)}${metric('Invoices shared',state.invoices.filter(i=>(i.supplier===me().org||i.customer===me().org)).length,'Across all connections','▤')}${metric('Scopes in use',new Set(conns.flatMap(c=>{try{return JSON.parse(c.scopes||'[]')}catch{return[]}})).size,'What partners can see','⌁')}</div><div class="card panel">${panelTitle('Connection requests and active links',`<span class="subtle">${conns.length} total</span>`)}<form id="connectionForm" class="connection-form" hidden><div><b>Invite a business</b><small>This local demo does not send email. A new request stays pending until you preview partner acceptance.</small></div><div class="connection-fields"><label>Business name<input name="name" required maxlength="120" placeholder="e.g. Kaveri Components"></label><label>Business email<input name="email" type="email" placeholder="finance@example.in"></label><label>GSTIN (optional)<input name="gstin" maxlength="15" placeholder="15-character GSTIN"></label></div><div class="connection-scopes"><label><input type="checkbox" name="scopes" value="exchange_invoices" checked> Exchange invoices</label><label><input type="checkbox" name="scopes" value="share_payment_status" checked> Share payment status</label></div><div class="actions"><button type="button" class="btn" data-action="cancel-invite">Cancel</button><button class="btn primary">Send connection request</button></div></form><div class="connection-grid">${conns.map(cardFor).join('')||'<div class="empty">No connection requests yet.</div>'}</div></div><div class="card panel" style="margin-top:15px">${panelTitle('Sharing stays scoped')}<p class="subtle">Connected businesses see only documents you explicitly share. They can’t see your other customers, vendor list, margins or ledger.</p><div class="scope-pills"><span class="scope-chip on">✓ Exchange invoices</span><span class="scope-chip on">✓ Share payment status</span><span class="scope-chip off">◦ Share statements (off)</span><span class="scope-chip off">◦ Share catalog (off)</span></div></div>`;
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

function morePage(){const links=[['approvals','✓','Approvals','Invoices and bills waiting for review'],['disputes','⚑','Disputes','Shared invoice questions'],['payments','₹','Payment status','Settlement updates on invoices'],['team','♙','Team workload','Queue volume and role-level workload'],['activity','◷','Activity trail','Recent events on visible invoices'],['insights','⌁','Flow insights','Due-date, approval and exception indicators'],['portal','↗',portalLabel(),'Open the external invoice view'],['connections','◎','Connections','Manage trading partners']].filter(([key])=>{if(me().external)return key==='portal';if(role==='ar')return !['approvals'].includes(key);if(role==='approver')return !['connections','payments'].includes(key);return true});return `${head('WORKSPACE · MORE','More workspace tools','Open another part of your finance workspace.')}<div class="more-grid">${links.map(([key,icon,title,desc])=>`<button class="btn more-link" data-page="${key}"><span>${icon}</span><span><b>${title}</b><small>${desc}</small></span><span class="more-arrow">→</span></button>`).join('')}<button class="btn more-link" data-action="roles"><span>⇄</span><span><b>Switch demo role</b><small>See the workspace from another perspective</small></span><span class="more-arrow">→</span></button></div><div class="more-lower"><section class="card panel">${panelTitle('Your current view')}<div class="more-facts"><div><small>Signed in as</small><b>${esc(me().label)}</b></div><div><small>Business</small><b>${esc(company(me().org).name)}</b></div><div><small>Can create invoices</small><b>${me().create?'Yes':'No'}</b></div><div><small>Can record approvals</small><b>${me().approve?'Yes':'No'}</b></div></div><p class="subtle">Role changes affect which records and actions appear. They do not change the underlying demo data.</p></section><section class="card panel">${panelTitle('Demo boundaries')}<ul class="boundary-list"><li>No AI layer. Every status change is a recorded human action.</li><li>No money moves. Payment status is a label on the shared record.</li><li>No email is sent. Invites and reminders are simulated locally.</li><li>Data stays in a local SQLite file on this machine.</li></ul></section></div>`}
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
function render(){const front=['landing','roles'].includes(page);document.querySelector('.app').classList.toggle('front-page',front);document.querySelector('.app').classList.toggle('portal-page',page==='portal');const titles={landing:'Overview',roles:'Choose a role',boot:'Opening demo',overview:'Overview',invoices:'Invoices',detail:'Invoice detail',builder:'Invoice builder',bills:'Bills inbox',billUpload:'Add bill',approvals:'Approvals',disputes:'Disputes',connections:'Connections',network:'Connections',team:'Team workload',activity:'Activity trail',insights:'Flow insights',payments:'Payment status',portal:portalLabel(),more:'More'};$('#crumb').textContent=titles[page]||'Overview';const activePage=page==='detail'||page==='builder'?'invoices':page==='billUpload'?'bills':page==='business'?'connections':page;const hidden=roleHiddenPages();document.querySelectorAll('#nav button,.mobile-tabs button').forEach(b=>{const key=b.dataset.page;b.hidden=hidden.has(key);const on=key===activePage||((role==='buyer_portal'||role==='vendor_portal')&&key==='portal');b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});const portalBtn=$('#nav [data-page="portal"]');if(portalBtn)portalBtn.innerHTML=`<span class="icon">↗</span>${portalLabel()}`;const counts=queueCounts();for(const[k,v]of Object.entries(counts)){const x=$(`#nav [data-page="${k}"] .count`);if(x)x.textContent=v}const views={landing:pageLanding,roles:rolePicker,boot:bootPage,overview:dashboard,invoices:invoicesPage,detail:detailPage,builder,bills:billsPage,billUpload,connections:connectionsPage,network:connectionsPage,portal:portalPage,business:businessPage,approvals:approvalsPage,disputes:disputesPage,payments:paymentsPage,team:teamPage,activity:activityPage,insights:insightsPage,more:morePage};$('#view').innerHTML=(views[page]||dashboard)();$('#sidebar').classList.remove('open');if(page==='builder')taxPreview();syncThemeControls()}
function updateInvoiceRows(){renderInvoiceTable()}
function updateBillRows(){renderBillTable()}
async function changeInvoiceStatus(id,status,extra={}){await api(`/api/invoices/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status,actor:me().org,...extra})});await refresh();selectedId=id;page='detail';render();toast(`Invoice marked ${status.toLowerCase()}`)}
function exportSelectedInvoices(){const selected=[...document.querySelectorAll('[data-select]:checked')].map(x=>x.dataset.select);const rows=invoicesForRole().filter(i=>selected.includes(i.id));if(!rows.length){toast('Select at least one invoice to export','warn');return}const values=[['Invoice','Business','Issue date','Due date','Amount INR','Status'],...rows.map(i=>[i.id,company(me().side==='supplier'?i.customer:i.supplier).name,i.issue_date,i.due_date,Number(i.total).toFixed(2),i.status])];const csv=values.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='invoiceos-invoices.csv';a.click();URL.revokeObjectURL(url);toast(`${rows.length} invoice${rows.length===1?'':'s'} exported`,'success')}
document.addEventListener('click',async e=>{const themeToggle=e.target.closest('[data-theme-toggle]');if(themeToggle){e.preventDefault();setTheme(currentTheme()==='dark'?'light':'dark',true);return}const mapNode=e.target.closest('[data-map-select]');if(mapNode){document.querySelectorAll('[data-map-select]').forEach(n=>{n.setAttribute('aria-pressed',String(n===mapNode))});const[key,title,description]=mapFeatures[mapNode.dataset.mapSelect]||[];const focus=$('.map-focus');if(focus&&title)focus.innerHTML=`<b>${esc(title)}</b><span>${esc(description)}</span>`;return}
const earlyStatus=e.target.closest('[data-status]');if(earlyStatus){const[id,next]=earlyStatus.dataset.status.split('|');try{await changeInvoiceStatus(id,next)}catch(err){toast(err.message,'error')}return}
const earlyBill=e.target.closest('[data-bill-status]');if(earlyBill){const[id,next]=earlyBill.dataset.billStatus.split('|');const back=page;try{await api(`/api/bills/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status:next,actor:me().org})});await refresh();page=back;render();toast(`Bill marked ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}
const earlyConn=e.target.closest('[data-connection]');if(earlyConn){const[id,next]=earlyConn.dataset.connection.split('|');const back=page;try{await api(`/api/connections/${encodeURIComponent(id)}/status`,{method:'POST',body:JSON.stringify({status:next,actor:me().org})});await refresh();page=back;render();toast(`Connection ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}
const statusFilter=e.target.closest('[data-status-filter]');if(statusFilter){invoiceFilters={...invoiceFilters,status:statusFilter.dataset.statusFilter,q:''};page='invoices';render();return}const quickStatus=e.target.closest('[data-quick-status]');if(quickStatus){invoiceFilters.status=quickStatus.dataset.quickStatus;const sel=$('#invoiceStatus');if(sel)sel.value=invoiceFilters.status;document.querySelectorAll('[data-quick-status]').forEach(b=>b.classList.toggle('active',b.dataset.quickStatus===invoiceFilters.status));renderInvoiceTable();return}const sortBtn=e.target.closest('[data-sort]');if(sortBtn){const k=sortBtn.dataset.sort;if(invoiceSort.key===k)invoiceSort.dir*=-1;else{invoiceSort.key=k;invoiceSort.dir=['issue_date','due_date','total'].includes(k)?-1:1}renderInvoiceTable();return}const rolePick=e.target.closest('[data-role-pick]');if(rolePick){if(!demoRoute){location.href='/demo?role='+encodeURIComponent(rolePick.dataset.rolePick);return}changeRole(rolePick.dataset.rolePick);return}const teamRole=e.target.closest('[data-team-role]');if(teamRole){changeRole(teamRole.dataset.teamRole);if(me().external){return}page='team';render();return}const nav=e.target.closest('[data-page]');if(nav){if(!demoRoute){location.href='/demo?page='+encodeURIComponent(nav.dataset.page);return}page=nav.dataset.page;render();return}if(e.target.closest('[data-select],#selectAll'))return;const open=e.target.closest('[data-open]');if(open){if(!demoRoute){location.href='/demo?page=detail&id='+encodeURIComponent(open.dataset.open);return}selectedId=open.dataset.open;const opened=state.invoices.find(i=>i.id===selectedId);if(me().side==='buyer'&&opened?.status==='Sent'){try{await changeInvoiceStatus(selectedId,'Viewed')}catch(err){toast(err.message,'error')}return}page='detail';render();return}const status=e.target.closest('[data-status]');if(status){const[id,next]=status.dataset.status.split('|');try{await changeInvoiceStatus(id,next)}catch(err){toast(err.message,'error')}return}const bs=e.target.closest('[data-bill-status]');if(bs){const[id,next]=bs.dataset.billStatus.split('|');try{await api(`/api/bills/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status:next,actor:me().org})});await refresh();page='bills';render();toast(`Bill marked ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}const con=e.target.closest('[data-connection]');if(con){const[id,next]=con.dataset.connection.split('|');try{await api(`/api/connections/${encodeURIComponent(id)}/status`,{method:'POST',body:JSON.stringify({status:next,actor:me().org})});await refresh();page='connections';render();toast(`Connection ${next.toLowerCase()}`)}catch(err){toast(err.message,'error')}return}const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;if(action==='submit-invoice'){const f=$('#invoiceForm');if(!f?.reportValidity())return;if(me().readOnly||!me().create)return;const payload=Object.fromEntries(new FormData(f).entries());payload.supplier=me().org;for(const k of ['qty','rate','tax'])payload[k]=Number(payload[k]);try{await api('/api/invoices',{method:'POST',body:JSON.stringify(payload)});await refresh();page='invoices';render();toast('Invoice shared with buyer','success')}catch(err){toast(err.message,'error')}return}else if(action.startsWith('status|')){const[,id,next]=action.split('|');try{await changeInvoiceStatus(id,next)}catch(err){toast(err.message,'error')}}else if(action==='landing'){page='landing';render()}else if(action==='roles'){page='roles';render()}else if(action==='new'||action==='invoices'||action==='builder'||action==='bills'||action==='connections'||action==='payments'||action==='portal'||action==='overview'||action==='refresh'){if(action==='refresh')await refresh();else{page=action;render()}}else if(action==='showDispute'){const form=$('#disputeForm');if(form)form.style.display='block'}else if(action==='billUpload'){page='billUpload';render()}else if(action==='sample-ocr'){const f=$('#billForm');if(f){f.vendor.value='northstar';f.vendor_invoice_id.value='NS-2026-0192';f.description.value='Brand identity and campaign design';f.amount.value='186000';f.po_number.value='MR-PO-880';f.confidence.value='99% · Review suggested';toast('Sample fields filled — review before saving')}}else if(action==='invite'){const f=$('#connectionForm');if(f){f.hidden=false;f.querySelector('[name=name]')?.focus()}}else if(action==='approve-all'){try{const c=queueCounts();const n=c.invoicePending.length+c.billPending.length;for(const i of c.invoicePending)await api(`/api/invoices/${encodeURIComponent(i.id)}/status`,{method:'PATCH',body:JSON.stringify({status:'Approved',actor:me().org})});for(const b of c.billPending)await api(`/api/bills/${encodeURIComponent(b.id)}/status`,{method:'PATCH',body:JSON.stringify({status:'Approved',actor:me().org})});await refresh();page='approvals';render();toast(`Approved ${n} record${n===1?'':'s'}`)}catch(err){toast(err.message,'error')}}else if(action==='cancel-invite'){const f=$('#connectionForm');if(f){f.reset();f.hidden=true}}else if(action==='global-search'){openCmdk()}else if(action==='bulk-remind'){toast('Reminder draft prepared. No message sent in demo.')}else if(action==='bulk-export'){exportSelectedInvoices()} });
document.addEventListener('input',e=>{if(e.target.id==='invoiceSearch'){invoiceFilters.q=e.target.value;updateInvoiceRows()}if(e.target.id==='billSearch')updateBillRows();if(e.target.closest('#invoiceForm'))taxPreview()});document.addEventListener('change',e=>{if(e.target.id==='activityFilter'){const v=e.target.value;document.querySelectorAll('.event-day').forEach(day=>{let shown=0;day.querySelectorAll('.activity-record').forEach(row=>{const ok=v==='all'||row.dataset.activityKind===v;row.hidden=!ok;if(ok)shown++});day.hidden=!shown})}if(e.target.id==='invoiceStatus'){invoiceFilters.status=e.target.value;updateInvoiceRows()}if(e.target.id==='billStatus')updateBillRows();if(e.target.id==='selectAll')document.querySelectorAll('[data-select]').forEach(c=>c.checked=e.target.checked);if(e.target.matches('[data-select],#selectAll')){const n=document.querySelectorAll('[data-select]:checked').length;$('#bulkBar')?.classList.add('show');if($('#selectedCount'))$('#selectedCount').textContent=`${n} selected`}if(e.target.closest('#invoiceForm'))taxPreview()});
document.addEventListener('submit',async e=>{if(e.target.id==='connectionForm'){e.preventDefault();const f=new FormData(e.target);try{await api('/api/businesses',{method:'POST',body:JSON.stringify({name:f.get('name'),email:f.get('email'),gstin:f.get('gstin'),requester:me().org,scopes:f.getAll('scopes')})});await refresh();page='connections';render();toast('Connection request created — no email was sent','success')}catch(err){toast(err.message,'error')}}if(e.target.id==='invoiceForm'){e.preventDefault();if(me().readOnly||!me().create)return;const payload=Object.fromEntries(new FormData(e.target).entries());payload.supplier=me().org;for(const k of ['qty','rate','tax'])payload[k]=Number(payload[k]);try{await api('/api/invoices',{method:'POST',body:JSON.stringify(payload)});await refresh();page='invoices';render();toast('Invoice shared with buyer','success')}catch(err){toast(err.message,'error')}}if(e.target.id==='commentForm'){e.preventDefault();try{await api(`/api/invoices/${encodeURIComponent(selectedId)}/comments`,{method:'POST',body:JSON.stringify({body:new FormData(e.target).get('body'),actor:me().org})});await refresh();page='detail';render();toast('Reply added to shared invoice','success')}catch(err){toast(err.message,'error')}}if(e.target.id==='disputeForm'){e.preventDefault();const reason=new FormData(e.target).get('reason');try{await api(`/api/invoices/${encodeURIComponent(selectedId)}/comments`,{method:'POST',body:JSON.stringify({body:`Query raised: ${reason}`,actor:me().org})});await changeInvoiceStatus(selectedId,'Dispute',{dispute_reason:reason})}catch(err){toast(err.message,'error')}}if(e.target.id==='billForm'){e.preventDefault();const f=new FormData(e.target);const rawConfidence=parseFloat(f.get('confidence'))||0;const payload={buyer:me().org,vendor:f.get('vendor'),vendor_invoice_id:f.get('vendor_invoice_id'),description:f.get('description'),amount:Number(f.get('amount')),due_date:f.get('due_date'),po_number:f.get('po_number'),source:'manual',status:'Received',ocr_confidence:rawConfidence>1?rawConfidence/100:rawConfidence};try{await api('/api/bills',{method:'POST',body:JSON.stringify(payload)});await refresh();page='bills';render();toast('Bill saved to the AP inbox','success')}catch(err){toast(err.message,'error')}}});
$('#role').innerHTML=Object.entries(profiles).map(([id,p])=>`<option value="${id}">${esc(p.label)}</option>`).join('');$('#role').addEventListener('change',e=>changeRole(e.target.value));document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCmdk();return}const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'')||document.activeElement?.isContentEditable;if(e.key==='/'&&!typing&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();openCmdk();return}if(e.key==='Escape'&&page==='detail'&&!cmdkOpen()){page='invoices';render()}});

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

try{render()}catch(e){console.error('Initial render failed',e)}
refresh().catch(err=>{if(['landing','roles'].includes(page)){showNetBanner('Workspace records could not load. Start server.py, then retry.');return}$('#view').innerHTML=`<div class="card panel" role="alert"><h2>Can’t reach the local demo</h2><p class="subtle">Start it with <code>python3 server.py</code> from the outputs folder, then retry. ${esc(err.message)}</p><p><button class="btn primary" onclick="retryConnection()">Retry connection</button></p></div>`});

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
    const dt=Math.min(.05,(now-last)/1000);last=now;
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
  const sel='.landing-strip>div,.landing-workflow .section-heading,.workflow-steps article,.landing-capabilities .section-heading,.capability-grid button,.landing-insights>div,.landing-idea .section-heading,.idea-card,.landing-insights-v2 .section-heading,.insights-v2-grid>*,.landing-trust .section-heading,.trust-grid>*,.landing-plainly .plainly-box,.landing-bottom,.landing-footer';
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
  splitHero(root);setupReveal(root);animateLandingCounts(root);
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


/* Landing-only interactions: workflow story, role tabs and capability filters. */
function selectLandingThread(root,index){
 const t=landingThreads[Number(index)];if(!root||!t)return;
 root.style.setProperty('--thread-accent',t.accent);
 const fields={"[data-thread-honest]":t.honest||"","[data-thread-label]":t.label,"[data-thread-title]":t.title,"[data-thread-pain]":t.pain,"[data-thread-solution]":t.with,"[data-thread-note]":t.note,"[data-thread-record-label]":t.recordLabel,"[data-thread-record-kind]":t.recordKind,"[data-thread-record-status]":t.recordStatus,"[data-thread-partner]":t.partner,".record-partner small":t.partnerNote};
 for(const [sel,value] of Object.entries(fields)){const el=root.querySelector(sel);if(el)el.textContent=value}
 root.querySelectorAll('[data-thread-tab]').forEach(b=>{const selected=b===root.querySelector('[data-thread-tab="'+Number(index)+'"]');b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected))});
 animateLandingChange(root.querySelector('.thread-layout'));
}
function animateLandingChange(el){if(!el)return;el.classList.remove('landing-change');void el.offsetWidth;el.classList.add('landing-change');setTimeout(()=>el.classList.remove('landing-change'),420)}
function selectLandingFlow(root,id){
 const f=landingFlows.find(x=>x.id===id);if(!root||!f)return;
 const put=(sel,value)=>{const el=root.querySelector(sel);if(el)el.textContent=value};
 put('[data-flow-kicker]',f.tab);put('[data-flow-title]',f.title);put('[data-flow-description]',f.desc);put('[data-flow-note]',f.note);put('[data-flow-poster]',f.tab);put('[data-flow-poster-steps]',f.steps.length+' steps · sample data');
 root.querySelectorAll('.workflow-step').forEach((card,i)=>{const step=f.steps[i]||["","",""];card.querySelector('[data-flow-role]').textContent=step[0];card.querySelector('[data-flow-title]').textContent=step[1];card.querySelector('[data-flow-copy]').textContent=step[2]||"The record stays in the finance workflow.";const chip=card.querySelector('[data-flow-honest]');if(chip)chip.textContent=step[3]||""});
 root.querySelectorAll('[data-flow-tab]').forEach(b=>{const selected=b.dataset.flowTab===id;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected))});
 animateLandingChange(root.querySelector('.workflow-steps'));
}
function selectLandingPersona(root,id){
 const p=landingPersonas.find(x=>x.id===id);if(!root||!p)return;
 const put=(sel,value)=>{const el=root.querySelector(sel);if(el)el.textContent=value};
 put('[data-persona-place]',p.place);put('[data-persona-title]',p.title);put('[data-persona-description]',p.desc);put('[data-persona-card-title]',p.tab+' workspace');
 const list=root.querySelector('[data-persona-points]');if(list)list.innerHTML=p.points.map(x=>'<li>'+esc(x)+'</li>').join('');
 const open=root.querySelector('[data-persona-open]');if(open){open.dataset.rolePick=p.id;open.textContent=p.open+' →'}
 root.querySelectorAll('[data-persona]').forEach(b=>{const selected=b.dataset.persona===id;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected))});
 animateLandingChange(root.querySelector('.persona-panel'));
}
function updateLandingWeave(root){
 if(!root)return;
 const selected=[...root.querySelectorAll('[data-weave-thread]:checked')].map(input=>Number(input.dataset.weaveThread)).filter(i=>landingThreads[i]);
 const put=(selector,value)=>{const el=root.querySelector(selector);if(el)el.textContent=value};
 const count=selected.length,word=count===1?'thread':'threads';
 root.classList.toggle('has-weave',count>0);
 put('[data-weave-count]',count+' of 7 '+(count===1?'thread':'threads')+' woven');
 put('[data-weave-title]',count?'Your finance flow is starting to connect.':'Start with the work that slips between tools.');
 put('[data-weave-copy]',count?'Selected: '+selected.map(i=>landingThreads[i].tab).join(' · ')+'. The buttons below open existing InvoiceOS views.':'Select a thread above. InvoiceOS will connect it to the finance views already in this demo.');
 put('[data-weave-visual-caption]',count?count+' '+word.toUpperCase()+' · SAMPLE VIEWS':'YOUR FINANCE WORKFLOW · SAMPLE VIEWS');
 const empty=root.querySelector('[data-weave-empty]');if(empty)empty.hidden=count>0;
 const art=root.querySelector('[data-weave-art]');if(art)art.innerHTML=selected.map((threadIndex,position)=>{const t=landingThreads[threadIndex];return "<span class='weave-strand' style='--strand-color:"+esc(t.accent)+";--strand-index:"+position+"' title='"+esc(t.tab)+"'><b>"+String(threadIndex+1).padStart(2,'0')+"</b><i>"+esc(t.tab)+"</i></span>"}).join('');
 const modules=root.querySelector('[data-weave-modules]');
 if(modules){
  const views=new Map();selected.forEach(i=>landingThreadViews[i].forEach(view=>views.set((view.page?'page:':'role:')+(view.page||view.role),view)));
  modules.innerHTML=count?[...views.values()].map(view=>"<button type='button' class='weave-module' "+(view.page?"data-page='"+esc(view.page)+"'":"data-role-pick='"+esc(view.role)+"'")+">"+esc(view.label)+" <span>→</span></button>").join(''):'<span class="weave-placeholder">Your selected views will appear here.</span>';
 }
 animateLandingChange(root.querySelector('.weave-illustration'));animateLandingChange(root.querySelector('.weave-summary'));
}
document.addEventListener('click',e=>{
 const menu=e.target.closest('[data-landing-menu]');
 if(menu){const nav=menu.closest('.landing-nav'),panel=nav&&nav.querySelector('.landing-mobile-menu'),open=menu.getAttribute('aria-expanded')!=='true';if(panel)panel.hidden=!open;menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');return}
 if(e.target.closest('.landing-mobile-menu a')){const panel=e.target.closest('.landing-mobile-menu'),button=panel&&panel.parentElement.querySelector('[data-landing-menu]');if(panel)panel.hidden=true;if(button){button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation')}return}
 const thread=e.target.closest('[data-thread-tab]');if(thread){selectLandingThread(thread.closest('[data-thread-explorer]'),thread.dataset.threadTab);return}
 const flow=e.target.closest('[data-flow-tab]');if(flow){selectLandingFlow(flow.closest('.landing-workflow'),flow.dataset.flowTab);return}
 const persona=e.target.closest('[data-persona]');if(persona){selectLandingPersona(persona.closest('[data-persona-explorer]'),persona.dataset.persona);return}
 const draftBtn=e.target.closest('[data-draft-save],[data-draft-edit],[data-draft-drop]');if(draftBtn){const card=draftBtn.closest('[data-draft-card]'),copy=card&&card.querySelector('[data-draft-copy]'),edit=card&&card.querySelector('[data-draft-edit]');if(copy){if(draftBtn.hasAttribute('data-draft-save')){copy.contentEditable='false';if(edit){edit.textContent='Edit first'}toast('Draft saved to the invoice thread · demo only')}else if(draftBtn.hasAttribute('data-draft-edit')){const on=copy.isContentEditable;copy.contentEditable=on?'false':'true';if(!on){copy.focus();draftBtn.textContent='Done editing'}else{draftBtn.textContent='Edit first'}}else{if(copy.dataset.original)copy.textContent=copy.dataset.original;copy.contentEditable='false';if(edit){edit.textContent='Edit first'}toast('Draft discarded · nothing was sent')}}return}
 const lockBtn=e.target.closest('[data-lock-edit],[data-lock-del]');if(lockBtn){const demo=lockBtn.closest('[data-lock-demo]'),verdict=demo&&demo.querySelector('[data-lock-verdict]');if(verdict){verdict.hidden=false;verdict.textContent=lockBtn.hasAttribute('data-lock-edit')?'Refused · recorded events are append-only. A correction would be a new event, not a rewrite of this one.':'Refused · the trail stays. You can record a correction as a new event, but a recorded event cannot be deleted.'}toast('Not available · demo records are append-only','warn');return}
 const filter=e.target.closest('[data-domain-filter]');if(filter){const section=filter.closest('.landing-capabilities');section.querySelectorAll('[data-domain-filter]').forEach(b=>{const selected=b===filter;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected))});applyModuleFilter(section);return}
});
document.addEventListener('change',e=>{const input=e.target.closest&&e.target.closest('[data-weave-thread]');if(input)updateLandingWeave(input.closest('[data-thread-weaver]'))});
document.addEventListener('input',e=>{const s=e.target.closest&&e.target.closest('[data-module-search]');if(s)applyModuleFilter(s.closest('.landing-capabilities'))});
function applyModuleFilter(section){
  if(!section)return;
  const active=section.querySelector('[data-domain-filter].active');
  const domain=active?active.dataset.domainFilter:'all';
  const search=section.querySelector('[data-module-search]');
  const term=search?(search.value||'').trim().toLowerCase():'';
  let shown=0;
  section.querySelectorAll('.finance-module').forEach(card=>{
    const ok=(domain==='all'||card.dataset.domain===domain)&&(!term||card.textContent.toLowerCase().includes(term));
    card.hidden=!ok;if(ok)shown++;
  });
  const empty=section.querySelector('[data-module-empty]');if(empty)empty.hidden=shown>0;
}
