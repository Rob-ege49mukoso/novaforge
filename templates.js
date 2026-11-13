'use strict';
// Gabarits de génération — le code produit est RÉEL et fonctionnel :
// app       = fichiers HTML autonomes (UI + logique + persistance locale),
// fullstack = front HTML synchronisé avec son API (CRUD + /state, persistance serveur),
// mobile    = full stack + projet Capacitor (APK/iOS compilable) + PWA,
// api       = routes JS exécutées par le runtime de la plateforme,
// agent     = configuration d'agent exécutée par le moteur d'agents.
const PALETTE = ['#4f7cff', '#8b5cf6', '#22d3ee', '#34d399', '#f59e0b', '#ec4899'];
const colorFor = (s) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projet';

// ---------------- Domaines (métier) ----------------
const DOMAINS = {
  delivery: {
    label: 'Livraison',
    entities: [
      { key: 'orders', label: 'Commandes', fields: [
        { k: 'client', l: 'Client', t: 'text' }, { k: 'adresse', l: 'Adresse de livraison', t: 'text' },
        { k: 'statut', l: 'Statut', t: 'select', opts: ['Nouvelle', 'En préparation', 'En cours', 'Livrée', 'Annulée'] },
        { k: 'prix', l: 'Prix (USD)', t: 'number' },
      ], seed: [
        { client: 'Aïcha M.', adresse: 'Lekmako, Kintambo', statut: 'En cours', prix: 12 },
        { client: 'Paul K.', adresse: 'Gombe, Avenue de la Paix', statut: 'Livrée', prix: 8.5 },
      ] },
      { key: 'drivers', label: 'Livraisons en cours', fields: [
        { k: 'nom', l: 'Chauffeur', t: 'text' }, { k: 'plaque', l: 'Plaque', t: 'text' }, { k: 'zone', l: 'Zone', t: 'text' },
      ], seed: [{ nom: 'Dieudonné T.', plaque: 'CD-4521-K', zone: 'Nord' }] },
    ],
    extra: 'messages',
  },
  shop: {
    label: 'Boutique / E-commerce',
    entities: [
      { key: 'products', label: 'Produits', fields: [
        { k: 'nom', l: 'Nom', t: 'text' }, { k: 'prix', l: 'Prix', t: 'number' }, { k: 'stock', l: 'Stock', t: 'number' }, { k: 'cat', l: 'Catégorie', t: 'text' },
      ], seed: [
        { nom: 'T-shirt coton', prix: 15, stock: 42, cat: 'Vêtements' },
        { nom: 'Casque audio', prix: 39, stock: 12, cat: 'Électronique' },
      ] },
      { key: 'orders', label: 'Commandes', fields: [
        { k: 'client', l: 'Client', t: 'text' }, { k: 'produit', l: 'Produit', t: 'text' },
        { k: 'statut', l: 'Statut', t: 'select', opts: ['En attente', 'Payée', 'Expédiée', 'Livrée'] }, { k: 'total', l: 'Total', t: 'number' },
      ], seed: [{ client: 'Mariam D.', produit: 'Casque audio', statut: 'Payée', total: 39 }] },
    ],
    extra: 'messages',
  },
  finance: {
    label: 'Gestion financière',
    entities: [
      { key: 'tx', label: 'Transactions', fields: [
        { k: 'lib', l: 'Libellé', t: 'text' }, { k: 'type', l: 'Type', t: 'select', opts: ['Revenu', 'Dépense'] },
        { k: 'montant', l: 'Montant', t: 'number' }, { k: 'cat', l: 'Catégorie', t: 'text' },
      ], seed: [
        { lib: 'Vente produit A', type: 'Revenu', montant: 250, cat: 'Ventes' },
        { lib: 'Achat fournitures', type: 'Dépense', montant: 60, cat: 'Fournitures' },
      ] },
    ],
    extra: null,
  },
  tasks: {
    label: 'Tâches / Productivité',
    entities: [
      { key: 'tasks', label: 'Tâches', fields: [
        { k: 'titre', l: 'Titre', t: 'text' }, { k: 'priorite', l: 'Priorité', t: 'select', opts: ['Basse', 'Moyenne', 'Haute'] },
        { k: 'statut', l: 'Statut', t: 'select', opts: ['À faire', 'En cours', 'Terminé'] }, { k: 'echeance', l: 'Échéance', t: 'date' },
      ], seed: [{ titre: 'Préparer la réunion', priorite: 'Haute', statut: 'En cours', echeance: '' }] },
    ],
    extra: null,
  },
  social: {
    label: 'Réseau social',
    entities: [
      { key: 'posts', label: 'Publications', fields: [
        { k: 'auteur', l: 'Auteur', t: 'text' }, { k: 'contenu', l: 'Contenu', t: 'text' },
      ], seed: [{ auteur: 'Vous', contenu: 'Bienvenue sur ma communauté !' }] },
    ],
    extra: 'messages',
  },
  blog: {
    label: 'Blog / Contenu',
    entities: [
      { key: 'articles', label: 'Articles', fields: [
        { k: 'titre', l: 'Titre', t: 'text' }, { k: 'contenu', l: 'Contenu', t: 'text' }, { k: 'statut', l: 'Statut', t: 'select', opts: ['Brouillon', 'Publié'] },
      ], seed: [{ titre: 'Mon premier article', contenu: 'Écrivez ici votre contenu…', statut: 'Publié' }] },
    ],
    extra: null,
  },
  crm: {
    label: 'CRM / Clients',
    entities: [
      { key: 'clients', label: 'Clients', fields: [
        { k: 'nom', l: 'Nom', t: 'text' }, { k: 'email', l: 'Email', t: 'text' },
        { k: 'statut', l: 'Statut', t: 'select', opts: ['Prospect', 'Contacté', 'Client', 'Inactif'] },
      ], seed: [{ nom: 'Société XYZ', email: 'contact@xyz.cd', statut: 'Prospect' }] },
      { key: 'followups', label: 'Suivis', fields: [
        { k: 'client', l: 'Client', t: 'text' }, { k: 'note', l: 'Note', t: 'text' }, { k: 'date', l: 'Date', t: 'date' },
      ], seed: [] },
    ],
    extra: 'messages',
  },
  restaurant: {
    label: 'Restaurant',
    entities: [
      { key: 'menu', label: 'Menu', fields: [
        { k: 'plat', l: 'Plat', t: 'text' }, { k: 'prix', l: 'Prix', t: 'number' }, { k: 'cat', l: 'Catégorie', t: 'text' },
      ], seed: [{ plat: 'Fried rice premium', prix: 12, cat: 'Plat' }] },
      { key: 'orders', label: 'Commandes', fields: [
        { k: 'client', l: 'Client', t: 'text' }, { k: 'plats', l: 'Plats', t: 'text' },
        { k: 'statut', l: 'Statut', t: 'select', opts: ['En attente', 'En cuisine', 'Servi', 'Payé'] },
      ], seed: [] },
    ],
    extra: null,
  },
  edu: {
    label: 'Éducation',
    entities: [
      { key: 'students', label: 'Étudiants', fields: [
        { k: 'nom', l: 'Nom', t: 'text' }, { k: 'classe', l: 'Classe', t: 'text' },
      ], seed: [{ nom: 'Nadia B.', classe: 'Tertiaire A' }] },
      { key: 'grades', label: 'Notes', fields: [
        { k: 'eleve', l: 'Élève', t: 'text' }, { k: 'matiere', l: 'Matière', t: 'text' }, { k: 'note', l: 'Note /20', t: 'number' },
      ], seed: [] },
    ],
    extra: null,
  },
  saas: {
    label: 'SaaS',
    entities: [
      { key: 'users', label: 'Utilisateurs', fields: [
        { k: 'email', l: 'Email', t: 'text' }, { k: 'plan', l: 'Plan', t: 'select', opts: ['Gratuit', 'Premium'] },
      ], seed: [{ email: 'demo@example.com', plan: 'Premium' }] },
      { key: 'invoices', label: 'Factures', fields: [
        { k: 'client', l: 'Client', t: 'text' }, { k: 'montant', l: 'Montant', t: 'number' }, { k: 'statut', l: 'Statut', t: 'select', opts: ['En attente', 'Payée'] },
      ], seed: [] },
    ],
    extra: null,
  },
  generic: {
    label: 'Générique',
    entities: [
      { key: 'items', label: 'Enregistrements', fields: [
        { k: 'titre', l: 'Titre', t: 'text' }, { k: 'description', l: 'Description', t: 'text' },
        { k: 'statut', l: 'Statut', t: 'select', opts: ['Nouveau', 'En cours', 'Terminé'] },
      ], seed: [{ titre: 'Premier élément', description: 'Modifiez-moi ou supprimez-moi.', statut: 'Nouveau' }] },
    ],
    extra: null,
  },
};

// ---------------- App HTML (mode local ET mode full stack) ----------------
function renderApp({ name, domain, features, color, backend = false, pwa = false, apiBase = 'api' }) {
  const d = DOMAINS[domain] || DOMAINS.generic;
  const hasMessages = d.extra === 'messages' && features.messages;
  const hesc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cfg = JSON.stringify({
    name: name, domain: d.label, entities: d.entities,
    hasMessages, hasStats: features.stats, hasExport: features.export, hasSearch: features.search,
    color, api: backend || false, pwa: pwa || false,
  });
  const pwaHead = pwa ? `\n<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="${color}">\n<meta name="mobile-web-app-capable" content="yes">` : '';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${hesc(name)}</title>${pwaHead}
<style>
:root{--bg:#0a0d16;--card:#11162a;--card2:#161d36;--txt:#e8ecf8;--mut:#8b93b0;--acc:${color};--bord:rgba(139,155,255,.14)}
*{box-sizing:border-box;margin:0}body{background:radial-gradient(1200px 600px at 80% -10%,rgba(139,92,246,.15),transparent),var(--bg);color:var(--txt);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh}
header{padding:18px 20px 10px;display:flex;align-items:center;gap:12px}
.logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--acc),#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}
h1{font-size:19px}.sub{color:var(--mut);font-size:12.5px}
nav{display:flex;gap:8px;padding:12px 20px;overflow-x:auto}
nav button{border:1px solid var(--bord);background:var(--card);color:var(--mut);padding:8px 14px;border-radius:10px;cursor:pointer;font-size:13.5px;white-space:nowrap}
nav button.on{color:#fff;border-color:var(--acc);background:linear-gradient(180deg,rgba(79,124,255,.25),rgba(139,92,246,.18));box-shadow:0 0 18px -6px var(--acc)}
main{padding:8px 20px 40px;max-width:980px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--bord);border-radius:14px;padding:16px;margin-bottom:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.stat{background:var(--card2);border:1px solid var(--bord);border-radius:12px;padding:14px}
.stat b{font-size:24px;display:block}.stat span{color:var(--mut);font-size:12.5px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{color:var(--mut);text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.4px;padding:8px 10px;border-bottom:1px solid var(--bord)}
td{padding:9px 10px;border-bottom:1px solid rgba(139,155,255,.08)}tr:last-child td{border:none}
.del{background:none;border:none;color:#f87171;cursor:pointer;font-size:15px}
input,select,textarea{background:#0d1224;border:1px solid var(--bord);color:var(--txt);border-radius:9px;padding:9px 11px;font:inherit;width:100%}
.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px}
.lbl{font-size:12px;color:#8b93b0;display:block;margin-bottom:4px}
.btn{background:linear-gradient(135deg,var(--acc),#8b5cf6);color:#fff;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-weight:600;font-size:14px}
.btn.ghost{background:var(--card2);border:1px solid var(--bord);color:var(--mut)}
.badge{font-size:11.5px;padding:3px 9px;border-radius:99px;background:rgba(79,124,255,.15);color:#9db4ff;border:1px solid rgba(79,124,255,.3)}
.msgs{max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.msg{max-width:78%;padding:9px 13px;border-radius:14px;font-size:14px}
.msg.me{align-self:flex-end;background:linear-gradient(135deg,var(--acc),#8b5cf6)}
.msg.them{align-self:flex-start;background:var(--card2);border:1px solid var(--bord)}
.msg small{display:block;color:var(--mut);font-size:10.5px;margin-top:3px}
.row{display:flex;gap:10px}.row>*{flex:1}
.bar{height:8px;border-radius:99px;background:var(--card2);overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),#8b5cf6)}
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--card2);border:1px solid var(--acc);padding:10px 18px;border-radius:12px;opacity:0;transition:.3s;pointer-events:none}
#toast.on{opacity:1;transform:translateY(0)}
footer{text-align:center;color:var(--mut);font-size:12px;padding:16px}
</style></head><body>
<header><div class="logo">${hesc(name.slice(0, 1).toUpperCase())}</div>
<div><h1>${hesc(name)}</h1><div class="sub">${hesc(d.label)} · généré par NovaForge</div></div></header>
<nav id="nav"></nav><main id="main"></main><div id="toast"></div>
<footer>${backend ? 'Full stack — données synchronisées avec le serveur (repli hors ligne : navigateur).' : 'Application autonome — les données sont stockées dans votre navigateur (localStorage).'}</footer>
<script>
var CFG=${cfg};
var API='${apiBase}'; /* API_BASE — URL de l'API (défaut : même origine). Pour un hébergement séparé, remplacez par l'URL complète de votre API. */
var LS='nfx_'+CFG.name.replace(/\\W+/g,'_');
function localState(){try{var s=JSON.parse(localStorage.getItem(LS));if(s&&s.entities)return s}catch(e){}
 var s={app:CFG.name,entities:{},msgs:[]};CFG.entities.forEach(function(e){s.entities[e.key]=e.seed?JSON.parse(JSON.stringify(e.seed)).map(function(r,i){var o={id:i+1};for(var k in r)o[k]=r[k];return o}):[]});return s}
var S=localState();
function save(){localStorage.setItem(LS,JSON.stringify(S));if(CFG.api)syncApi()}
function syncApi(){try{fetch(API+'/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(S)}).catch(function(){})}catch(e){}}
function pullApi(){if(!CFG.api)return;fetch(API+'/state').then(function(r){return r.json()}).then(function(d){if(d&&d.entities){S={app:d.app||CFG.name,entities:d.entities,msgs:d.msgs||[]};localStorage.setItem(LS,JSON.stringify(S));render();toast('Données du serveur chargées ✓')}}).catch(function(){})}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
var tab=CFG.hasStats?'dash':CFG.entities[0].key;
function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('on');setTimeout(function(){t.classList.remove('on')},2200)}
function nav(){var n=document.getElementById('nav');n.innerHTML='';
 if(CFG.hasStats)add('dash','📊 Tableau de bord');
 CFG.entities.forEach(function(e){add(e.key,e.label)});
 if(CFG.hasMessages)add('msgs','💬 Messagerie');
 add('set','⚙️ Réglages');
 function add(k,l){var b=document.createElement('button');b.textContent=l;b.className=tab===k?'on':'';b.onclick=function(){tab=k;render()};n.appendChild(b)}}
function dash(){var m=document.getElementById('main');var h='<div class="card"><div class="stats">';
 CFG.entities.forEach(function(e){h+='<div class="stat"><b>'+S.entities[e.key].length+'</b><span>'+esc(e.label)+'</span></div>'});
 h+='</div></div>';
 var main=CFG.entities[0];var selF=null;main.fields.forEach(function(f){if(f.t==='select')selF=f});var k0=selF?selF.k:main.fields[0].k;var by={};
 S.entities[main.key].forEach(function(r){var k=r[k0]||'—';by[k]=(by[k]||0)+1});var mx=1;Object.keys(by).forEach(function(k){if(by[k]>mx)mx=by[k]});
 h+='<div class="card"><b>Répartition</b><div style="margin-top:12px">';
 Object.keys(by).forEach(function(k){h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px"><span style="width:130px;font-size:13px;color:#8b93b0">'+esc(k)+'</span><div class="bar" style="flex:1"><i style="width:'+Math.round(by[k]/mx*100)+'%"></i></div><b style="width:34px;text-align:right">'+by[k]+'</b></div>'});
 h+='</div></div>';m.innerHTML=h}
function ent(e){var m=document.getElementById('main');var rows=S.entities[e.key];
 var form=e.fields.map(function(f){var o=f.t==='select'?'<select name="'+f.k+'">'+f.opts.map(function(x){return '<option>'+x+'</option>'}).join('')+'</select>':'<input name="'+f.k+'" type="'+(f.t==='date'?'date':'text')+'">';return '<span class="lbl">'+esc(f.l)+'</span>'+o}).join('');
 var list='<table><thead><tr>'+e.fields.map(function(f){return '<th>'+esc(f.l)+'</th>'}).join('')+'<th></th></tr></thead><tbody>'+
  rows.map(function(r){return '<tr>'+e.fields.map(function(f){return '<td>'+esc(r[f.k])+'</td>'}).join('')+'<td><button class="del" data-key="'+e.key+'" data-id="'+r.id+'">✕</button></td>'}).join('')||('<tr><td colspan="'+(e.fields.length+1)+'" style="color:#8b93b0">Aucun élément — ajoutez le premier ci-dessus.</td></tr>')+'</tbody></table>';
 m.innerHTML='<div class="card"><form id="f" class="form">'+form+'</form><button class="btn" id="addBtn">＋ Ajouter</button></div>'+
  (CFG.hasSearch?'<div class="card row"><input id="q" placeholder="🔎 Rechercher…"><span class="badge">'+rows.length+' éléments</span></div>':'')+
  '<div class="card" style="padding:6px 10px;overflow-x:auto">'+list+'</div>';
 document.getElementById('addBtn').onclick=function(){add(e.key)};
 var f=document.getElementById('f');f.addEventListener('submit',function(ev){ev.preventDefault();add(e.key)});
 document.querySelectorAll('.del').forEach(function(b){b.onclick=function(){del(b.dataset.key,parseInt(b.dataset.id))}});
 var q=document.getElementById('q');if(q)q.oninput=function(){applySearch(q.value)}}
function applySearch(t){t=(t||'').toLowerCase();document.querySelectorAll('#main tbody tr').forEach(function(tr){if(!tr.cells||!tr.cells.length)return;tr.style.display=!t||tr.textContent.toLowerCase().indexOf(t)>-1?'':'none'})}
function add(key){var e=CFG.entities.find(function(x){return x.key===key});
 var fd=new FormData(document.getElementById('f'));var obj={};
 e.fields.forEach(function(f){obj[f.k]=fd.get(f.k)||''});
 if(!obj[e.fields[0].k])return toast('Renseignez au moins le premier champ');
 var rows=S.entities[key];var id=rows.length?Math.max.apply(null,rows.map(function(r){return r.id||0}))+1:1;
 var it={id:id};e.fields.forEach(function(f){it[f.k]=obj[f.k]});rows.push(it);save();render();toast('Ajouté ✓')}
function del(key,id){S.entities[key]=S.entities[key].filter(function(r){return String(r.id)!==String(id)});save();render();toast('Supprimé')}
function msgs(){var m=document.getElementById('main');
 m.innerHTML='<div class="card"><b>💬 Messagerie</b><div class="msgs" id="ml"></div><div class="row"><input id="mi" placeholder="Écrivez un message…"><button class="btn" id="sendBtn">Envoyer</button></div></div>';
 var ml=document.getElementById('ml');
 S.msgs.forEach(function(msg){var d=document.createElement('div');d.className='msg '+(msg.me?'me':'them');d.innerHTML=esc(msg.t)+'<small>'+(esc(msg.me?'Vous':'Contact')+' · '+(msg.ts||''))+'</small>';ml.appendChild(d)});
 ml.scrollTop=ml.scrollHeight;
 document.getElementById('sendBtn').onclick=send}
function send(){var v=document.getElementById('mi').value.trim();if(!v)return;
 S.msgs.push({t:v,me:true,ts:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});save();msgs();
 setTimeout(function(){S.msgs.push({t:'Message bien reçu !'+(CFG.api?' (démo)':' (démo locale)'),me:false,ts:new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});save();msgs()},900)}
function set(){var m=document.getElementById('main');
 m.innerHTML='<div class="card"><b>⚙️ Réglages</b><p style="color:#8b93b0;margin:8px 0">Renommez l'+String.fromCharCode(39)+'application, exportez ou réinitialisez les données.</p>'+
 '<div class="row" style="margin-bottom:12px"><input id="rn" value="'+esc(S.app)+'"><button class="btn ghost" id="rnBtn">Renommer</button></div>'+
 '<div class="row"><button class="btn" id="x1">⬇ Export CSV</button><button class="btn ghost" id="x2">⬇ Export JSON</button><button class="btn ghost" id="x3">↺ Réinitialiser</button></div></div>';
 document.getElementById('rnBtn').onclick=function(){S.app=document.getElementById('rn').value;save();toast('Renommé')};
 document.getElementById('x1').onclick=exportCsv;
 document.getElementById('x2').onclick=exportJson;
 document.getElementById('x3').onclick=function(){if(confirm('Réinitialiser toutes les données ?')){localStorage.removeItem(LS);S=localState();save();render()}}}
function exportCsv(){var NL=String.fromCharCode(10);var csv='entitee'+NL;CFG.entities.forEach(function(e){csv+=e.fields.map(function(f){return f.l}).join(';')+NL;S.entities[e.key].forEach(function(r){csv+=e.fields.map(function(f){return '"'+String(r[f.k]).replace(/"/g,'""')+'"'}).join(';')+NL})});
 var a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(csv);a.download='export.csv';a.click()}
function exportJson(){var a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(S,null,2));a.download='donnees.json';a.click()}
function render(){nav();var m=document.getElementById('main');
 if(tab==='dash')dash();else if(tab==='msgs')msgs();else if(tab==='set')set();
 else{var e=CFG.entities.find(function(x){return x.key===tab});if(e)ent(e)}}
render();
pullApi();
if(CFG.pwa&&'serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}
</script></body></html>`;
}

// ---------------- API (prefixe /api pour fullstack & mobile) ----------------
function renderApiFile({ name, domain, apiPrefix = '' }) {
  const d = API_DOMAINS[domain] || API_DOMAINS.generic;
  const P = apiPrefix || '';
  const lines = [];
  lines.push(`'use strict';`);
  lines.push(`// API « ${name} » — générée par NovaForge`);
  lines.push(`var CTX=null;function setCtx(c){CTX=c;}`);
  lines.push(`const routes = [];`);
  lines.push(`function j(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, {'Content-Type':'application/json'}); res.end(s); }`);
  lines.push(`routes.push({ method:'GET', path:${JSON.stringify(P || '/')}, handler:(q,res,ctx)=>j(res,200,{ api:'${name}', version:'1.0', endpoints:routes.map(r=>r.method+' '+r.path) }) });`);
  lines.push(`routes.push({ method:'GET', path:${JSON.stringify(P + '/health')}, handler:(q,res,ctx)=>j(res,200,{ ok:true }) });`);
  lines.push(`const ALL = {};`);
  for (const r of d.resources) {
    lines.push(`ALL.${r.key} = { list:()=>CTX.db.list('${r.key}'), get:(id)=>CTX.db.get('${r.key}',id), create:(b)=>CTX.db.create('${r.key}',b), update:(id,b)=>CTX.db.update('${r.key}',id,b), remove:(id)=>CTX.db.remove('${r.key}',id) };`);
    lines.push(`routes.push({ method:'GET', path:${JSON.stringify(P + '/' + r.key)}, handler:(q,res,ctx)=>j(res,200,{ data:ALL.${r.key}.list() }) });`);
    lines.push(`routes.push({ method:'POST', path:${JSON.stringify(P + '/' + r.key)}, handler:(q,res,ctx)=>{ if(!q.body||Object.keys(q.body).length===0)return j(res,400,{error:'corps requis'}); const it=ALL.${r.key}.create(q.body); j(res,201,{data:it}) } });`);
    lines.push(`routes.push({ method:'GET', path:${JSON.stringify(P + '/' + r.key + '/:id')}, handler:(q,res,ctx)=>{ const it=ALL.${r.key}.get(q.params.id); it?j(res,200,{data:it}):j(res,404,{error:'introuvable'}) } });`);
    lines.push(`routes.push({ method:'PUT', path:${JSON.stringify(P + '/' + r.key + '/:id')}, handler:(q,res,ctx)=>{ const it=ALL.${r.key}.update(q.params.id,q.body||{}); it?j(res,200,{data:it}):j(res,404,{error:'introuvable'}) } });`);
    lines.push(`routes.push({ method:'DELETE', path:${JSON.stringify(P + '/' + r.key + '/:id')}, handler:(q,res,ctx)=>{ ALL.${r.key}.remove(q.params.id)?j(res,200,{ok:true}):j(res,404,{error:'introuvable'}) } });`);
  }
  // Synchronisation d'état complète (front full stack ↔ serveur)
  lines.push(`routes.push({ method:'GET', path:${JSON.stringify(P + '/state')}, handler:(q,res,ctx)=>j(res,200,CTX.db.all()) });`);
  lines.push(`routes.push({ method:'POST', path:${JSON.stringify(P + '/state')}, handler:(q,res,ctx)=>{ const s=q.body||{}; if(!s.entities||typeof s.entities!=='object')return j(res,400,{error:'entities requis'}); CTX.db.replaceAll(s); j(res,200,{ok:true}) } });`);
  lines.push(`module.exports = { name:'${name}', description:'API ${d.label} générée par NovaForge', routes, setCtx };`);
  return lines.join('\n');
}
function renderApiReadme({ name, domain }) {
  const d = API_DOMAINS[domain] || API_DOMAINS.generic;
  let md = `# API « ${name} »\n\nGénérée par NovaForge. Ressource(s) : ${d.resources.map((r) => `\`${r.key}\``).join(', ')}.\n\n## Endpoints\n\n| Méthode | Route | Description |\n|---|---|---|\n| GET | \`/\` | Info API + liste des routes |\n| GET | \`/health\` | Monitoring |\n`;
  for (const r of d.resources) {
    md += `| GET | \`/${r.key}\` | Liste les ${r.label.toLowerCase()}\n| POST | \`/${r.key}\` | Crée un ${r.label.toLowerCase()}\n| GET | \`/${r.key}/:id\` | Détail\n| PUT | \`/${r.key}/:id\` | Mise à jour\n| DELETE | \`/${r.key}/:id\` | Suppression |\n`;
  }
  md += `\n## Lancement autonome\n\n\`\`\`bash\nnpm install express\ncorepack enable 2>/dev/null || true\nnpm start\n# l'API écoute sur http://localhost:4000\n\`\`\`\n`;
  return md;
}

// ---------------- Serveur autonome (API seule OU front + API) ----------------
function renderStandaloneServer({ name, withFront = false }) {
  return `'use strict';
// Serveur autonome pour « ${name} » — export NovaForge${withFront ? ' (front + API, un seul port)' : ''}
const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./api.js');
const DATA = path.join(__dirname, 'data.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.css': 'text/css' };
const load = () => { try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return {}; } };
const dump = (d) => fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
let dbState = load();
const ctx = {
  db: {
    list: (k) => dbState[k] || [],
    get: (k, id) => (dbState[k] || []).find((r) => String(r.id) === String(id)),
    create: (k, body) => { dbState[k] = dbState[k] || []; const id = dbState[k].length ? Math.max(...dbState[k].map((r) => r.id || 0)) + 1 : 1; const it = { id, ...body }; dbState[k].push(it); dump(dbState); return it; },
    update: (k, id, body) => { const it = ctx.db.get(k, id); if (!it) return null; Object.assign(it, body); dump(dbState); return it; },
    remove: (k, id) => { const b = dbState[k] || []; const i = b.findIndex((r) => String(r.id) === String(id)); if (i < 0) return false; b.splice(i, 1); dump(dbState); return true; },
    all: () => ({ app: dbState.app || '', entities: Object.fromEntries(Object.keys(dbState).filter((k) => Array.isArray(dbState[k])).map((k) => [k, dbState[k]])), msgs: dbState.msgs || [] }),
    replaceAll: (s) => { const n = {}; if (s && s.entities) for (const k in s.entities) if (Array.isArray(s.entities[k])) n[k] = s.entities[k].map((x) => ({ ...x })); n.msgs = Array.isArray(s.msgs) ? s.msgs : []; n.app = s.app || ''; dbState = n; dump(dbState); return true; },
  },
};
if (api.setCtx) api.setCtx(ctx);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const finish = (code, ctype, data) => { res.writeHead(code, { 'Content-Type': ctype || 'application/json', 'Cache-Control': 'no-store' }); res.end(data); };
  ${withFront ? `// Front : servir les fichiers statiques (index.html, sw.js, manifest…)
  if (req.method === 'GET' && !u.pathname.startsWith('/api')) {
    const p = u.pathname === '/' ? '/index.html' : u.pathname;
    const f = path.join(__dirname, p);
    if (f.startsWith(__dirname) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      return finish(200, MIME[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
    }
  }` : ''}
  if (req.method === 'POST' || req.method === 'PUT') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b || '{}'); } catch { return finish(400, null, '{}'); }
      route({ method: req.method, url: u.pathname, body }, finish);
    });
  } else route({ method: req.method, url: u.pathname, body: {} }, finish);
});
function route(q, finish) {
  for (const r of api.routes) {
    const segs = r.path.split('/').filter(Boolean);
    const pseg = q.url.split('/').filter(Boolean);
    if (r.method !== q.method || segs.length !== pseg.length) continue;
    const params = {};
    let ok = true;
    segs.forEach((s, i) => { if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(pseg[i]); else if (s !== pseg[i]) ok = false; });
    if (!ok) continue;
    const fakeRes = { writeHead: (c, h) => { fakeRes._c = c; fakeRes._h = h || {}; }, end: (s) => finish(fakeRes._c || 200, (fakeRes._h && fakeRes._h['Content-Type']) || 'application/json', s == null ? '' : s) };
    r.handler({ params, body: q.body }, fakeRes, ctx);
    return;
  }
  ${withFront ? `if (q.method === 'GET') { const idx = path.join(__dirname, 'index.html'); if (fs.existsSync(idx)) return finish(200, MIME['.html'], fs.readFileSync(idx)); }` : ''}
  finish(404, null, JSON.stringify({ error: 'route introuvable' }));
}
const port = process.env.PORT || 4000;
server.listen(port, () => console.log('${name}${withFront ? ' (front + API) ' : ' API '}sur http://localhost:' + port));
`;
}

// ---------------- PWA ----------------
function renderManifest({ name, color }) {
  const initial = String(name).slice(0, 1).toUpperCase() || 'N';
  const icon = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="96" fill="${color}"/><text x="256" y="340" font-size="250" font-family="sans-serif" font-weight="800" fill="#fff" text-anchor="middle">${initial}</text></svg>`
  );
  return JSON.stringify({
    name, short_name: String(name).slice(0, 12) || 'App',
    description: 'Application générée par NovaForge',
    start_url: '.', scope: '.', display: 'standalone',
    background_color: '#0a0d16', theme_color: color || '#4f7cff',
    icons: [{ src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }, null, 2);
}
function renderServiceWorker() {
  return `// Service worker NovaForge — PWA (cache de l'app, API en réseau d'abord)
var CACHE = 'nfx-sw-v1';
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(['/']); }).catch(function () {}));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  var isApi = url.pathname.indexOf('api/') > -1;
  if (isApi) {
    e.respondWith(fetch(e.request).then(function (r) {
      var c = r.clone(); caches.open(CACHE).then(function (ch) { ch.put(e.request, c); }).catch(function () {});
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (m) { return m || new Response(JSON.stringify({ error: 'hors ligne' }), { headers: { 'Content-Type': 'application/json' } }); });
    }));
  } else {
    e.respondWith(fetch(e.request).then(function (r) {
      var c = r.clone(); caches.open(CACHE).then(function (ch) { ch.put(e.request, c); }).catch(function () {});
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (m) { return m || Response.error(); });
    }));
  }
});
`;
}

// ---------------- Mobile (Capacitor) ----------------
function renderCapacitorConfig({ name, slug }) {
  return JSON.stringify({
    appId: 'com.novaforge.' + slug,
    appName: name,
    webDir: 'www',
    server: { androidScheme: 'https' },
  }, null, 2);
}
function renderMobilePackageJson({ name, slug }) {
  return JSON.stringify({
    name: slug,
    version: '1.0.0',
    private: true,
    description: `${name} — app mobile générée par NovaForge (Capacitor + PWA)`,
    scripts: {
      www: 'node make-www.js',
      'android-open': 'npx cap open android',
      server: 'node server.js',
    },
    dependencies: { '@capacitor/core': '^6.0.0' },
    devDependencies: { '@capacitor/cli': '^6.0.0', '@capacitor/android': '^6.0.0', '@capacitor/ios': '^6.0.0' },
  }, null, 2);
}
function renderMakeWww() {
  return `'use strict';
// Prépare le dossier www/ pour Capacitor (front + PWA uniquement)
const fs = require('fs');
fs.mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) {
  if (fs.existsSync(f)) fs.copyFileSync(f, 'www/' + f);
}
console.log('www/ prêt — vous pouvez lancer : npx cap sync android');
`;
}
function renderFullstackReadme({ name, domain }) {
  const d = API_DOMAINS[domain] || API_DOMAINS.generic;
  return `# ${name}

Application **full stack** générée par NovaForge (domaine « ${d.label} »).

## Contenu
- \`index.html\` — interface (PWA installable), synchronisée avec son API
- \`api.js\` — API REST : CRUD sur ${d.resources.map((r) => `\`${r.key}\``).join(', ')} + \`GET/POST /api/state\` (synchro complète)
- \`manifest.webmanifest\` + \`sw.js\` — mode PWA (installable, repli hors ligne)
- \`openapi.json\` — documentation OpenAPI 3.0

## Lancement autonome
\`\`\`bash
node server.js        # front + API sur http://localhost:4000
\`\`\`
- Interface : \`http://localhost:4000/\`
- API : \`http://localhost:4000/api/products\`, \`/api/health\`, …
- Persistance : \`data.json\` (créé au premier écriture)

## Installation (PWA)
Ouvrez l'app dans un navigateur (Chrome/Edge/Safari) → « Installer l'application ». Elle fonctionne alors comme une app, avec repli hors ligne.
`;
}
function renderMobileReadme({ name, slug, domain }) {
  return `# ${name} — App mobile

App **mobile (Android / iOS)** générée par NovaForge (domaine « ${(API_DOMAINS[domain] || API_DOMAINS.generic).label} »).
Projet complet : front web + PWA + API + configuration Capacitor.

## Structure
- \`index.html\` — l'application (front PWA, synchronisé avec son API)
- \`sw.js\` + \`manifest.webmanifest\` — PWA (installable, repli hors ligne)
- \`api.js\` + \`server.js\` — le backend (REST + synchronisation d'état)
- \`capacitor.config.json\` — configuration mobile (appId com.novaforge.${slug})
- \`make-www.js\` — prépare le dossier \`www/\` consommé par Capacitor

## 🤖 Générer l'APK Android (sur votre machine)
Prérequis : Node.js 18+ et Android Studio (Android SDK).
\`\`\`bash
npm install
npm run www            # prépare www/
npx cap add android    # première fois seulement
npx cap sync android
npx cap open android   # Android Studio
# puis : Build → Build App Bundle(s)/APK(s) → Build APK(s)
# ou en ligne de commande :
cd android && ./gradlew assembleDebug
# APK : android/app/build/outputs/apk/debug/app-debug.apk
\`\`\`

## 🍎 Version iOS (sur macOS)
\`\`\`bash
npm install && npm run www
npx cap add ios
npx cap open ios       # Xcode → Product → Archive
\`\`\`

## ☁️ Où vit le backend ?
- Sur la **plateforme NovaForge** : l'app est déjà servie (front + API) dans son aperçu.
- Hébergement séparé : \`node server.js\` sur n'importe quel serveur, puis modifiez la constante \`API_BASE\` en tête de \`index.html\` pour pointer vers l'URL de l'API.

> Note honnête : NovaForge **génère le projet mobile complet et testé** ; la compilation de l'APK (gradle/Xcode) s'effectue sur votre machine car elle nécessite le SDK Android/iOS.
`;
}

const API_DOMAINS = {
  delivery: { label: 'Livraison', resources: [
    { key: 'orders', label: 'Orders', seed: [{ id: 1, client: 'Aïcha M.', adresse: 'Lekmako', statut: 'En cours', prix: 12 }] },
    { key: 'drivers', label: 'Drivers', seed: [{ id: 1, nom: 'Dieudonné T.', zone: 'Nord' }] } ] },
  shop: { label: 'Boutique', resources: [
    { key: 'products', label: 'Products', seed: [{ id: 1, nom: 'T-shirt', prix: 15, stock: 42 }] },
    { key: 'orders', label: 'Orders', seed: [] },
    { key: 'customers', label: 'Customers', seed: [] } ] },
  finance: { label: 'Finance', resources: [
    { key: 'accounts', label: 'Accounts', seed: [{ id: 1, nom: 'Compte principal', solde: 1500 }] },
    { key: 'transactions', label: 'Transactions', seed: [{ id: 1, lib: 'Vente', type: 'revenu', montant: 250 }] } ] },
  tasks: { label: 'Tâches', resources: [
    { key: 'tasks', label: 'Tasks', seed: [{ id: 1, titre: 'Démo', statut: 'todo' }] } ] },
  social: { label: 'Social', resources: [
    { key: 'users', label: 'Users', seed: [{ id: 1, nom: 'Utilisateur démo' }] },
    { key: 'posts', label: 'Posts', seed: [] },
    { key: 'messages', label: 'Messages', seed: [] } ] },
  crm: { label: 'CRM', resources: [
    { key: 'customers', label: 'Customers', seed: [{ id: 1, nom: 'Société XYZ', statut: 'prospect' }] },
    { key: 'deals', label: 'Deals', seed: [] } ] },
  saas: { label: 'SaaS', resources: [
    { key: 'customers', label: 'Customers', seed: [] },
    { key: 'subscriptions', label: 'Subscriptions', seed: [] } ] },
  generic: { label: 'Générique', resources: [
    { key: 'items', label: 'Items', seed: [{ id: 1, titre: 'Premier élément' }] } ] },
};

// ---------------- Agent ----------------
function renderAgentConfig({ name, description, persona, tools }) {
  return {
    name,
    persona,
    description,
    system_prompt:
      `Tu es ${name}, un agent IA créé sur NovaForge. Mission : ${description}. ` +
      `Personnalité : ${persona}. Réponds en français, de façon concise et utile. ` +
      `Utilise les outils mis à ta disposition quand c'est pertinent et signale toute action que tu effectues.`,
    tools: tools || ['builtin:calculator', 'builtin:datetime', 'builtin:web_fetch'],
    created: true,
  };
}

module.exports = {
  renderApp, renderApiFile, renderApiReadme, renderStandaloneServer, renderAgentConfig,
  renderManifest, renderServiceWorker,
  renderCapacitorConfig, renderMobilePackageJson, renderMakeWww,
  renderFullstackReadme, renderMobileReadme,
  DOMAINS, API_DOMAINS, colorFor, slug, PALETTE,
};
