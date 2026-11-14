'use strict';
/* NovaForge — SPA (vanilla JS, 0 dépendance) */
window.NFX = (function () {
  const N = { user: null, status: null, conv: null };

  // ---------- Utils ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n) => (n == null ? '—' : new Date(n).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
  const money = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $');
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^• /gm, '• ');

  function toast(msg, type = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + type;
    d.textContent = msg;
    $('#toasts').appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = '.4s'; setTimeout(() => d.remove(), 400); }, 3400);
  }

  function confirmModal(title, text, danger = true) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
        <div class="row"><button class="btn ghost" id="mNo">Annuler</button><button class="btn ${danger ? 'danger' : ''}" id="mYes">Confirmer</button></div></div>`;
      document.body.appendChild(bg);
      $('#mNo', bg).onclick = () => { bg.remove(); resolve(false); };
      $('#mYes', bg).onclick = async () => { bg.remove(); resolve(true); };
      bg.onclick = (e) => { if (e.target === bg) { bg.remove(); resolve(false); } };
    });
  }

  async function api(path, { method = 'GET', body } = {}) {
    const r = await fetch('/api/v1/' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await r.json(); } catch { /* ignore */ }
    if (r.status === 401) { if (!location.hash.startsWith('#/login') && !location.hash.startsWith('#/register')) location.hash = '#/login'; throw new Error(data.error || 'Session expirée'); }
    if (!r.ok) throw new Error(data.error || 'Erreur ' + r.status);
    return data;
  }

  // ---------- Streaming SSE ----------
  /** Découpe une trame SSE brute en {event, data}. */
  function parseSseFrame(frame) {
    let event = '';
    const data = [];
    for (const line of String(frame).split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) return null;
    const raw = data.join('\n');
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    return { event: event || 'message', data: parsed };
  }

  /** Lit un flux SSE et appelle onEvent(event, data) pour chaque trame reçue. */
  async function readSse(res, onEvent) {
    if (!res.body) throw new Error('Réponse sans flux de données.');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSseFrame(frame);
        if (ev) onEvent(ev.event, ev.data);
      }
    }
  }

  /** Active/désactive les boutons d'arrêt et d'envoi de tous les panneaux de chat. */
  function setStreaming(on) {
    document.querySelectorAll('[data-stream-stop]').forEach((b) => { b.hidden = !on; });
    document.querySelectorAll('[data-stream-send]').forEach((b) => { b.disabled = on; });
  }

  /**
   * Bulle de réponse en cours : indicateur de saisie, texte incrémental,
   * trace des outils utilisés.
   */
  function createStreamBubble(container) {
    const box = document.createElement('div');
    box.className = 'msg a streaming';
    const status = document.createElement('div');
    status.className = 'stream-status';
    status.innerHTML = '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span><span>Réponse en cours…</span>';
    const text = document.createElement('div');
    text.className = 'stream-text';
    const tools = document.createElement('div');
    tools.className = 'stream-tools';
    box.append(status, text, tools);
    container.appendChild(box);
    let live = false;
    let raw = '';
    let painted = 0;
    // Rendu Markdown rafraîchi au plus toutes les 60 ms : la frappe reste fluide.
    const paint = (force) => {
      const now = Date.now();
      if (!force && now - painted < 60) return;
      painted = now;
      text.innerHTML = md(raw);
    };
    return {
      box, text, tools,
      get raw() { return raw; },
      delta(t) {
        if (!live) { live = true; status.classList.add('off'); }
        raw += t;
        paint(false);
        box.scrollIntoView({ block: 'nearest' });
      },
      reset() { raw = ''; text.innerHTML = ''; },
      tool(name, phase) {
        let chip = tools.querySelector('[data-tool="' + CSS.escape(name) + '"]');
        if (!chip) {
          chip = document.createElement('span');
          chip.className = 'chip';
          chip.dataset.tool = name;
          tools.appendChild(chip);
        }
        chip.textContent = phase === 'end' ? '🔧 ' + name : '⏳ ' + name + '…';
      },
      setText(t) {
        if (t != null) raw = String(t);
        if (!live) { live = true; status.classList.add('off'); }
        paint(true);
      },
      fail(message) {
        status.classList.add('off');
        const d = document.createElement('div');
        d.className = 'stream-error';
        d.textContent = message;
        box.appendChild(d);
      },
      stop() {
        status.classList.add('off');
        const d = document.createElement('div');
        d.className = 'stream-stopped';
        d.textContent = '⏹ Génération arrêtée.';
        box.appendChild(d);
      },
    };
  }

  /**
   * Envoie un message et rend la réponse au fur et à mesure.
   * Le flux peut être interrompu à tout moment via le bouton « Arrêter ».
   */
  async function sendStreamChat({ url, body, container, onDone }) {
    const bubble = createStreamBubble(container);
    const ctrl = new AbortController();
    N._abort = ctrl;
    setStreaming(true);
    announce('Génération en cours.');
    let reply = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ ...body, stream: true }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let msg = 'Erreur ' + res.status;
        try { const d = await res.json(); msg = d.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      await readSse(res, (event, data) => {
        if (!data || typeof data !== 'object') return;
        if (event === 'delta') { bubble.delta(data.text || ''); reply += data.text || ''; }
        else if (event === 'round') bubble.reset();
        else if (event === 'tool') bubble.tool(data.tool, 'start');
        else if (event === 'tool_result') bubble.tool(data.tool, 'end');
        else if (event === 'done') {
          bubble.setText(data.reply != null ? data.reply : reply);
          reply = data.reply != null ? data.reply : reply;
          if (onDone) onDone(data, bubble);
        } else if (event === 'error') bubble.fail(data.error || 'Erreur du flux.');
      });
      if (!bubble.raw) bubble.setText(reply);
    } catch (e) {
      if (e.name === 'AbortError') bubble.stop();
      else bubble.fail(e.message || 'Erreur du flux.');
    } finally {
      N._abort = null;
      setStreaming(false);
      announce('Réponse terminée.');
    }
  }

  /** Annonce vocale (lecteurs d'écran) de l'état du flux. */
  function announce(msg) {
    const live = $('#live');
    if (live) live.textContent = msg;
  }

  const TYPE_ICO = { app: '🌐', api: '🔌', agent: '🤖', fullstack: '🧱', mobile: '📱' };
  const TYPE_LBL = { app: 'Application web', api: 'API', agent: 'Agent IA', fullstack: 'Full stack', mobile: 'Mobile (APK)' };
  const ENGINE_LBL = (p) => {
    const v = (p.versions || [])[ (p.versions || []).length - 1 ];
    if (!v) return '';
    return v.engine === 'ai' ? '🤖 ' + (v.engine_detail || 'IA') : '⚙️ Moteur local (hors ligne)';
  };
  function statusBadge(st) {
    const m = { draft: ['Brouillon', 'mut'], published: ['Publié', 'ok'], suspended: ['Suspendu', 'err'], in_moderation: ['Modération', 'warn'] };
    const [l, c] = m[st] || [st, 'mut'];
    return `<span class="badge ${c}">${l}</span>`;
  }

  // ---------- Auth views ----------
  function brand(small) {
    return `<div class="brand"><div class="logo">⚡</div><div><h1>Nova<em>Forge</em></h1><div class="tag">${small ? '' : 'La plateforme IA qui construit pour vous'}</div></div></div>`;
  }

  function viewLogin() {
    return `<div class="auth-wrap"><div class="auth-card">${brand()}
      <div class="card"><h3 style="margin-bottom:14px">Connexion</h3>
      <form id="fLogin">
        <div class="field"><label>Email</label><input class="inp" type="email" name="email" required autocomplete="username" placeholder="vous@exemple.com"></div>
        <div class="field"><label>Mot de passe</label><input class="inp" type="password" name="password" required autocomplete="current-password" placeholder="••••••••"></div>
        <button class="btn block">Se connecter</button>
        <div class="err" id="eLogin"></div>
      </form>
      <p class="hint">Pas de compte ? <span class="link" id="goReg">S’inscrire</span></p>
      </div></div></div>`;
  }

  function viewRegister() {
    return `<div class="auth-wrap"><div class="auth-card">${brand()}
      <div class="card"><h3 style="margin-bottom:6px">Créer un compte</h3>
      <p class="muted small" style="margin-bottom:14px">Email uniquement. Votre espace personnel vous attend.</p>
      <form id="fReg">
        <div class="field"><label>Email</label><input class="inp" type="email" name="email" required autocomplete="username" placeholder="vous@exemple.com"></div>
        <div class="field"><label>Mot de passe <span class="muted">(8+ caractères, majuscule, minuscule, chiffre)</span></label><input class="inp" type="password" name="password" required minlength="8" autocomplete="new-password"></div>
        <button class="btn block">S’inscrire</button>
        <div class="err" id="eReg"></div>
      </form>
      <p class="hint">Déjà inscrit ? <span class="link" id="goLogin">Se connecter</span></p>
      </div></div></div>`;
  }

  function viewSetup() {
    return `<div class="auth-wrap"><div class="auth-card" style="max-width:480px">${brand()}
      <div class="card">
      <div class="badge grad" style="margin-bottom:12px">Première initialisation</div>
      <h3 style="margin-bottom:6px">Créer le compte propriétaire</h3>
      <p class="muted small" style="margin-bottom:16px">Ce compte sera le <b>Super Admin</b> (propriétaire) de la plateforme. Le mot de passe est défini de façon sécurisée ici et n’est jamais codé en dur. Choisissez-le avec soin.</p>
      <form id="fSetup">
        <div class="field"><label>Email du propriétaire</label><input class="inp" type="email" name="email" value="robegemukoso49@gmail.com" required autocomplete="off"></div>
        <div class="field"><label>Mot de passe <span class="muted">(8+ caractères, majuscule, minuscule, chiffre, idéal + symbole)</span></label><input class="inp" type="password" name="password" required minlength="8" autocomplete="new-password"></div>
        <div class="field"><label>Confirmer le mot de passe</label><input class="inp" type="password" name="password2" required minlength="8" autocomplete="new-password"></div>
        <button class="btn block">🔐 Initialiser NovaForge</button>
        <div class="err" id="eSetup"></div>
      </form>
      </div></div></div>`;
  }

  function bindAuth() {
    const g = (id) => (e) => { e.preventDefault(); };
    if ($('#goReg')) $('#goReg').onclick = () => (location.hash = '#/register');
    if ($('#goLogin')) $('#goLogin').onclick = () => (location.hash = '#/login');

    const fL = $('#fLogin');
    if (fL) fL.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const d = await api('auth/login', { method: 'POST', body: { email: fL.email.value, password: fL.password.value } });
        N.user = d.user;
        location.hash = '#/dashboard';
        render();
      } catch (err) { $('#eLogin').textContent = err.message; }
    };
    const fR = $('#fReg');
    if (fR) fR.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const d = await api('auth/register', { method: 'POST', body: { email: fR.email.value, password: fR.password.value } });
        N.user = d.user;
        toast('Compte créé — bienvenue !', 'ok');
        location.hash = '#/dashboard';
        render();
      } catch (err) { $('#eReg').textContent = err.message; }
    };
    const fS = $('#fSetup');
    if (fS) fS.onsubmit = async (e) => {
      e.preventDefault();
      if (fS.password.value !== fS.password2.value) return ($('#eSetup').textContent = 'Les mots de passe ne correspondent pas.');
      try {
        const d = await api('setup', { method: 'POST', body: { email: fS.email.value, password: fS.password.value } });
        N.user = d.user;
        N.status = { initialized: true }; // sinon l'écran d'initialisation reste affiché
        toast('Plateforme initialisée — vous êtes Super Admin.', 'ok');
        location.hash = '#/dashboard';
        render();
      } catch (err) { $('#eSetup').textContent = err.message; }
    };
  }

  // ---------- Coque ----------
  function navItems() {
    const items = [
      ['#/dashboard', '🏠', 'Tableau de bord'],
      ['#/assistant', '💬', 'Assistant IA'],
      ['#/studio', '🛠️', 'Studio de création'],
      ['#/projects', '📁', 'Mes projets'],
      ['#/files', '📎', 'Mes fichiers'],
      ['#/automation', '🤖', 'Automatisation'],
      ['#/billing', '💳', 'Abonnement & paiements'],
      ['#/providers', '⚡', 'Orchestration IA'],
      ['#/mcp', '🔌', 'Serveurs MCP'],
    ];
    if (N.user && N.user.role === 'super_admin') items.push(['#/admin', '🛡️', 'Administration']);
    items.push(['#/settings', '⚙️', 'Paramètres']);
    return items;
  }

  function shell(title, content) {
    const items = navItems().map(([h, ic, l]) => `<div class="nav-item ${location.hash.startsWith(h) ? 'on' : ''}" data-h="${h}"><span class="ic">${ic}</span>${l}</div>`).join('');
    return `<div class="shell">
      <aside class="side" id="side">${brand(true)}${items}
        <div class="spacer"></div>
        <div class="userbox"><div class="row"><span class="badge ${N.user.role !== 'user' ? 'grad' : 'mut'}">${N.user.role === 'super_admin' ? 'Super Admin' : N.user.role === 'sub_admin' ? 'Sous-admin' : 'Utilisateur'}</span></div>
        <div class="em">${esc(N.user.email)}</div>
        <div style="margin-top:8px"><button class="btn ghost sm" id="logout">Déconnexion</button></div></div>
      </aside>
      <div class="main">
        <div class="topbar"><button class="burger" id="burger">☰</button><h2>${title}</h2>${planBadge()}</div>
        <div class="content" id="content">${content}</div>
      </div></div>`;
  }

  function planBadge() {
    if (!N.user) return '';
    return `<span class="badge ${N.user.role !== 'user' ? 'grad' : 'mut'}" id="planBadge">${esc((N._plan && N._plan.name) || 'Gratuit')}</span>`;
  }

  function bindShell() {
    document.querySelectorAll('.nav-item').forEach((el) => (el.onclick = () => { location.hash = el.dataset.h; $('#side') && $('#side').classList.remove('open'); }));
    if ($('#burger')) $('#burger').onclick = () => $('#side').classList.toggle('open');
    if ($('#logout')) $('#logout').onclick = async () => { try { await api('auth/logout', { method: 'POST' }); } catch { /* ignore */ } N.user = null; location.hash = '#/login'; render(); };
  }

  // ---------- Dashboard ----------
  async function viewDashboard() {
    const d = await api('dashboard');
    N._plan = d.plan;
    const pb = $('#planBadge'); if (pb) pb.textContent = d.plan.name + (d.plan.price ? '' : '');
    const c = d.counters || {};
    const limit = d.plan.creations_per_day;
    const pct = Math.min(100, Math.round((c.creations || 0) / Math.max(1, limit) * 100));
    const recent = d.recent.map((p) => `
      <div class="proj-card" style="margin-bottom:10px" >
        <div class="top"><div class="thumb" style="background:${p.color || '#4f7cff'}22;border:1px solid ${p.color || '#4f7cff'}55">${TYPE_ICO[p.type] || '📦'}</div>
        <h4><a href="#/projects/${p.id}" style="color:inherit">${esc(p.name)}</a></h4>${statusBadge(p.status)}</div>
        <div class="foot"><span class="chip">${TYPE_LBL[p.type]}</span>${ENGINE_LBL(p) ? `<span class="chip" title="${esc(ENGINE_LBL(p))}">${esc(ENGINE_LBL(p).split(' — ')[0])}</span>` : ''}<span class="chip">${fmt(p.created_at)}</span><span class="sp" style="flex:1"></span>
        <a class="btn sm ghost" href="#/projects/${p.id}">Ouvrir</a></div>
      </div>`).join('') || `<div class="empty">Aucun projet pour l’instant.<br><br><a class="link" href="#/studio">🛠️ Créer votre premier projet →</a></div>`;
    return shell('Tableau de bord', `
      <div class="grid g4 sec">
        <div class="stat"><div class="lbl">Projets</div><div class="val">${d.stats.total}</div><div class="sub">${d.stats.published} publié(s) · ${d.stats.drafts} brouillon(s)</div></div>
        <div class="stat"><div class="lbl">Créations aujourd’hui</div><div class="val">${c.creations || 0} <small style="font-size:14px;color:var(--mut)">/ ${limit}</small></div><div class="progress" style="margin-top:10px"><i style="width:${pct}%"></i></div></div>
        <div class="stat"><div class="lbl">Apps aujourd’hui</div><div class="val">${c.apps || 0} <small style="font-size:14px;color:var(--mut)">/ ${d.plan.apps_per_day}</small></div><div class="sub">quota applications</div></div>
        <div class="stat"><div class="lbl">Plan actif</div><div class="val" style="font-size:19px;padding-top:6px">${esc(d.plan.name)}</div><div class="sub">${d.subscription && d.subscription.expires_at ? 'expire le ' + fmt(d.subscription.expires_at) : 'sans expiration'}</div></div>
      </div>
      ${d.pending_payment ? `<div class="card sec" style="border-color:rgba(251,191,36,.4)"><div class="row"><span class="badge warn">Paiement en attente de validation</span><span class="sp"></span><a class="btn sm ghost" href="#/billing">Suivre →</a></div></div>` : ''}
      <div class="sec"><h3>Accès rapide</h3>
        <div class="grid g3">
          <a class="card" style="text-decoration:none;color:inherit;cursor:pointer" href="#/assistant"><div style="font-size:22px">💬</div><h4 style="margin-top:8px">Assistant IA</h4><p class="muted small">Décrivez votre idée, Nova la construit.</p></a>
          <a class="card" style="text-decoration:none;color:inherit;cursor:pointer" href="#/studio"><div style="font-size:22px">🛠️</div><h4 style="margin-top:8px">Studio de création</h4><p class="muted small">Applications, API, agents — 3 espaces dédiés.</p></a>
          <a class="card" style="text-decoration:none;color:inherit;cursor:pointer" href="#/automation"><div style="font-size:22px">🤖</div><h4 style="margin-top:8px">Automatisation</h4><p class="muted small">Tâches en ligne et hors ligne sur l’appareil hôte.</p></a>
        </div>
      </div>
      <div class="sec"><h3>Projets récents <span class="sp"></span><a class="link" href="#/projects">Tout voir →</a></h3>${recent}</div>
    `);
  }

  // ---------- Assistant ----------
  async function viewAssistant() {
    let convs = [];
    try { convs = (await api('assistant/conversations')).conversations; } catch { /* ignore */ }
    const el = document.createElement('div');
    return shell('Assistant IA', `
      <div class="grid g2" style="grid-template-columns:230px 1fr">
        <div class="card" style="align-self:start"><h4 style="margin-bottom:10px;font-size:13.5px">Conversations</h4>
          <div id="convList">${convs.map((c) => `<div class="nav-item ${N.conv === c.id ? 'on' : ''}" data-cid="${c.id}" style="font-size:12.5px;padding:8px 10px">${esc(c.title || 'Nouvelle conversation')}</div>`).join('') || '<p class="muted small">Aucune conversation</p>'}</div>
        </div>
        <div class="card" style="padding:0;overflow:hidden"><div class="chat" style="height:calc(100vh - 220px)">
          <div class="msgs" id="msgs"><div class="msg a">Bonjour 👋 Je suis <b>Nova</b>. Décrivez ce que vous voulez créer — par exemple « Crée-moi une application de livraison » — et je m’en occupe de A à Z (construction, tests, aperçu).</div></div>
          <div class="inbar"><input class="inp" id="chatIn" placeholder="Écrivez votre demande…" autocomplete="off"><button class="btn" id="chatSend" data-stream-send>Envoyer</button><button class="btn ghost stop" id="chatStop" data-stream-stop hidden>⏹ Arrêter</button></div>
        </div></div>
      </div>`);
  }

  async function sendChat() {
    const inp = $('#chatIn');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    const msgs = $('#msgs');
    msgs.insertAdjacentHTML('beforeend', `<div class="msg u">${esc(v)}</div>`);
    msgs.scrollTop = msgs.scrollHeight;
    await sendStreamChat({
      url: '/api/v1/assistant/chat',
      body: { message: v, conversation_id: N.conv || undefined },
      container: msgs,
      onDone: (data, bubble) => {
        N.conv = data.conversation_id;
        const acts = (data.actions || []).map((a) => actionBtn(a)).join('');
        if (acts) {
          const box = document.createElement('div');
          box.className = 'acts';
          box.innerHTML = acts;
          bubble.box.appendChild(box);
        }
        msgs.scrollTop = msgs.scrollHeight;
      },
    });
  }

  function actionBtn(a) {
    if (a.type === 'suggest') {
      return a.options.map((o) => `<button class="btn sm ghost" data-sug="${o}">${TYPE_ICO[o]} ${TYPE_LBL[o]}</button>`).join(' ');
    }
    if (a.type === 'create') return `<button class="btn sm" data-create="${esc(a.description)}" data-ctype="${esc(a.kind || '')}">${esc(a.label)}</button>`;
    if (a.type === 'goto') return `<a class="btn sm ghost" href="${a.to}">${esc(a.label)}</a>`;
    if (a.type === 'project_action') {
      const danger = a.action === 'delete';
      return `<button class="btn sm ${danger ? 'danger' : ''}" data-pact="${a.project_id}:${a.action}">${esc(a.label)}</button>`;
    }
    if (a.type === 'create_automation') return `<button class="btn sm" data-auto="${esc(a.description)}">${esc(a.label)}</button>`;
    return '';
  }

  async function doCreate(desc, type) {
    const btn = event.target.closest('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Construction…'; }
    try {
      const d = await api('projects/generate', { method: 'POST', body: { description: desc, type: type || undefined } });
      toast('Projet construit et testé !', 'ok');
      location.hash = '#/projects/' + d.project.id + '?fresh=1';
    } catch (e) {
      toast(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
    }
  }

  function bindAssistant() {
    if ($('#chatSend')) $('#chatSend').onclick = sendChat;
    if ($('#chatIn')) $('#chatIn').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
    if ($('#chatStop')) $('#chatStop').onclick = () => { if (N._abort) N._abort.abort(); };
    document.querySelectorAll('#convList .nav-item').forEach((el) => (el.onclick = () => {
      N.conv = el.dataset.cid;
      // v1 : rechargement simple
      render();
    }));
    document.body.addEventListener('click', async (e) => {
      const s = e.target.closest('[data-sug]');
      if (s) {
        $('#chatIn').value = `Crée-moi une ${s.dataset.sug === 'api' ? 'API' : s.dataset.sug === 'agent' ? 'agent IA pour mon service client' : 'application de gestion de mon activité'}`;
        sendChat();
        return;
      }
      const c = e.target.closest('[data-create]');
      if (c) return doCreate(c.dataset.create, c.dataset.ctype);
      const p = e.target.closest('[data-pact]');
      if (p) {
        const [id, action] = p.dataset.pact.split(':');
        if (action === 'delete') {
          if (!await confirmModal('Supprimer le projet ?', 'Cette action est définitive. Toutes les versions seront supprimées.')) return;
          await api('projects/' + id, { method: 'POST', body: { action, confirmed: true } });
          toast('Projet supprimé.', 'ok');
          render();
          return;
        }
        try {
          const d = await api('projects/' + id, { method: 'POST', body: { action } });
          toast(d.message || (action === 'publish' ? 'Projet publié (ou soumis à modération).' : 'Projet dépublié.'), 'ok');
          render();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      const a = e.target.closest('[data-auto]');
      if (a) {
        try {
          const d = await api('automation/task', { method: 'POST', body: { description: a.dataset.auto } });
          toast(d.needs_confirmation ? 'Tâche créée — confirmation requise dans Automatisation.' : 'Automatisation lancée !', 'ok');
          location.hash = '#/automation';
        } catch (err) { toast(err.message, 'err'); }
      }
    });
  }

  // ---------- Studio ----------
  async function viewStudio() {
    const uploadData = await api('uploads');
    const availableResources = uploadData.files || [];
    const sub = location.hash.split('/')[2];
    const type = ['app', 'api', 'agent', 'fullstack', 'mobile'].includes(sub) ? sub : 'app';
    const tabs = [
      ['app', '🌐', 'Créer une application web', 'Boutiques, livraisons, finance, dashboards — données navigateur (hors ligne)'],
      ['fullstack', '🧱', 'Créer une app full stack', 'Front + base de données serveur, PWA installable, export autonome'],
      ['mobile', '📱', 'Créer une app mobile', 'Android/iOS : projet Capacitor complet + PWA — APK compilable'],
      ['api', '🔌', 'Créer une API', 'REST/CRUD, documentation, tests, runtime intégré'],
      ['agent', '🤖', 'Créer un agent IA', 'Répond, analyse, utilise des outils (MCP, web, calcul)'],
    ];
    return shell('Studio de création', `
      <div class="studio-tabs">${tabs.map(([t, ic, h, p]) => `<div class="studio-tab ${t === type ? 'on' : ''}" data-st="${t}"><div class="ic">${ic}</div><h4>${h}</h4><p>${p}</p></div>`).join('')}</div>
      <div class="card">
        <h3>Décrivez votre projet en langage naturel</h3>
        <p class="muted small" style="margin-bottom:12px">L’IA comprend la demande, identifie les fonctionnalités, construit réellement le projet, le teste et vous montre l’aperçu. Exemples :</p>
        <div class="pill-row" style="margin-bottom:14px">
          <span class="chip" data-ex="Crée-moi une application de livraison de repas avec suivi des coursiers">🚚 Application de livraison</span>
          <span class="chip" data-ex="Je veux une API pour gérer ma boutique : produits, commandes, clients">🛒 API de boutique</span>
          <span class="chip" data-ex="Crée un agent IA pour mon service client, amical et patient">🎧 Agent service client</span>
          <span class="chip" data-ex="Développe une application de gestion financière avec statistiques et export">💰 Gestion financière</span>
          <span class="chip" data-ex="Crée un réseau social avec messagerie et publications">👥 Réseau social</span>
          <span class="chip" data-ex="Développe une boutique en ligne full stack avec base de données et multi-utilisateurs">🧱 Full stack (base de données)</span>
          <span class="chip" data-ex="Crée une application mobile Android de gestion financière, full stack avec base de données">📱 App mobile (Android)</span>
        </div>
        <div class="field"><textarea class="inp" id="genDesc" placeholder="Ex. : Crée-moi une application de livraison…"></textarea></div>
        <div class="resource-picker">
          <div class="field"><label for="resourceMode">Fichiers à intégrer</label><select class="inp" id="resourceMode"><option value="manual">Sélection manuelle</option><option value="auto">Sélection automatique par NovaForge (avec confirmation)</option></select></div>
          <div id="resourceChoices" class="resource-choices" data-manual-resources>${availableResources.map((f) => `<label class="resource-choice"><input type="checkbox" value="${esc(f.id)}" data-resource><span><b>${esc(f.name)}</b><small>${esc(f.mime || 'fichier')} · ${(Number(f.size || 0)/1048576).toFixed(2)} Mo</small></span></label>`).join('') || '<p class="hint">Aucun fichier importé. Vous pourrez en ajouter dans « Mes fichiers ».</p>'}</div>
          <p class="hint">Les fichiers texte compatibles peuvent être lus par le moteur. Les autres ressources sont liées au projet et conservées dans votre bibliothèque.</p>
        </div>
        <div class="row"><button class="btn" id="genGo">🚀 Construire le projet</button>
        <span class="muted small" id="genNote">Chaque création est validée côté serveur.</span></div>
      </div>
      <div id="genResult"></div>
    `);
  }

  async function finishGeneration(payload) {
    const box = $('#genResult');
    const btn = $('#genGo');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Construction en cours…'; }
    if (box) box.innerHTML = '<div class="card"><p>Intégration des ressources et génération du projet…</p></div>';
    try {
      const d = await api('projects/generate', { method: 'POST', body: payload });
      if (!d.project) throw new Error(d.error || 'La génération n’a pas abouti.');
      toast('Projet construit avec ses ressources !', 'ok');
      location.hash = '#/projects/' + d.project.id + '?fresh=1';
    } catch (e) {
      if (box) box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`;
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Construire le projet'; }
    }
  }

  function bindStudio() {
    document.querySelectorAll('.studio-tab').forEach((el) => (el.onclick = () => { location.hash = '#/studio/' + el.dataset.st; }));
    const resourceModeControl = $('#resourceMode');
    const resourceChoices = $('#resourceChoices');
    if (resourceModeControl && resourceChoices) {
      const syncResourceMode = () => { resourceChoices.style.display = resourceModeControl.value === 'manual' ? '' : 'none'; };
      resourceModeControl.onchange = syncResourceMode;
      syncResourceMode();
    }
    document.querySelectorAll('[data-ex]').forEach((el) => (el.onclick = () => { $('#genDesc').value = el.dataset.ex; }));
    if ($('#genGo')) $('#genGo').onclick = async () => {
      const desc = $('#genDesc').value.trim();
      if (!desc) return toast('Décrivez d’abord votre projet.', 'err');
      const type = location.hash.split('/')[2];
      const box = $('#genResult');
      $('#genGo').disabled = true;
      $('#genGo').innerHTML = '<span class="spin"></span> Construction en cours…';
      box.innerHTML = `<div class="card sec"><h3>Pipeline de réalisation</h3><div class="pipe" id="pipe"><div class="step run"><div class="ico"><span class="spin"></span></div><div><div class="tt">Analyse de la demande</div><div class="dd">Compréhension du type et des fonctionnalités…</div></div></div></div></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      try {
        const resourceMode = $('#resourceMode') ? $('#resourceMode').value : 'manual';
        const resourceIds = Array.from(document.querySelectorAll('[data-resource]:checked')).map((el) => el.value);
        let d = await api('projects/generate', { method: 'POST', body: { description: desc, type: ['app', 'api', 'agent', 'fullstack', 'mobile'].includes(type) ? type : undefined, resource_mode: resourceMode, resource_ids: resourceIds } });
        if (d.needs_confirmation) {
          box.innerHTML = `<div class="card"><h3>Vérifier les fichiers proposés</h3><p class="muted small">NovaForge a repéré ces ressources. Décochez celles que vous ne souhaitez pas intégrer.</p><div id="autoResourceChoices">${(d.resources || []).map((f) => `<label class="resource-choice"><input type="checkbox" checked value="${esc(f.id)}"><span><b>${esc(f.name)}</b><small>${esc(f.mime || 'fichier')} · ${(Number(f.size || 0)/1048576).toFixed(2)} Mo</small></span></label>`).join('') || '<p>Aucun fichier proposé.</p>'}</div><div class="row" style="margin-top:12px"><button class="btn" id="confirmResources">Confirmer et générer</button><button class="btn ghost" id="skipResources">Générer sans fichiers</button></div></div>`;
          $('#genGo').disabled = false; $('#genGo').textContent = '🚀 Construire le projet';
          $('#confirmResources').onclick = async () => {
            const chosen = Array.from(document.querySelectorAll('#autoResourceChoices input:checked')).map((el) => el.value);
            await finishGeneration({ description: desc, type, resource_mode: 'auto', resource_ids: chosen, confirm_resources: true });
          };
          $('#skipResources').onclick = async () => finishGeneration({ description: desc, type, resource_mode: 'manual', resource_ids: [] });
          return;
        }
        if (!d.project) throw new Error(d.error || 'La génération n’a pas abouti.');
        const pipe = d.project.pipeline || [];
        $('#pipe').innerHTML = pipe.map((s) => `<div class="step ${s.status === 'done' ? 'done' : s.status === 'error' ? 'err' : s.status === 'warning' ? 'run' : 'run'}"><div class="ico">${s.status === 'done' ? '✓' : s.status === 'error' ? '✗' : s.status === 'warning' ? '!' : '…'}</div><div><div class="tt">${esc(s.step)}</div><div class="dd">${esc(s.detail || '')}</div></div></div>`).join('');
        box.insertAdjacentHTML('beforeend', `<div class="row" style="margin-top:14px"><button class="btn" id="openNew">👁 Ouvrir l’aperçu</button><a class="btn ghost" href="#/projects">Mes projets</a></div>`);
        $('#openNew').onclick = () => (location.hash = '#/projects/' + d.project.id + '?fresh=1');
      } catch (e) {
        box.innerHTML = `<div class="card" style="border-color:rgba(248,113,113,.4)"><p style="color:var(--err)">${esc(e.message)}</p></div>`;
        $('#genGo').disabled = false;
        $('#genGo').textContent = '🚀 Construire le projet';
      }
    };
  }

  // ---------- Projets (liste) ----------
  async function viewProjects() {
    const d = await api('projects');
    const rows = d.projects.map((p) => `
      <div class="proj-card">
        <div class="top"><div class="thumb" style="background:${p.color || '#4f7cff'}22;border:1px solid ${p.color || '#4f7cff'}55">${TYPE_ICO[p.type] || '📦'}</div>
        <div style="flex:1;min-width:0"><h4>${esc(p.name)}</h4><div class="muted small">v${p.current_version} · ${fmt(p.created_at)}</div></div>${statusBadge(p.status)}</div>
        <div class="desc">${esc(p.description || '')}</div>
        <div class="foot">
          <a class="btn sm" href="#/projects/${p.id}">Ouvrir</a>
          ${p.type === 'api' ? `<a class="btn sm ghost" href="/run/${p.id}/" target="_blank">API</a>` : ''}
          <span class="chip">${TYPE_LBL[p.type]}</span>
        </div>
      </div>`).join('');
    return shell('Mes projets', `
      <div class="row sec" style="justify-content:flex-end"><a class="btn" href="#/studio">＋ Nouveau projet</a></div>
      ${d.projects.length ? `<div class="grid g3">${rows}</div>` : `<div class="empty">Aucun projet. <a class="link" href="#/studio">Créez-en un par simple description →</a></div>`}
    `);
  }

  // ---------- Projet (détail) ----------
  async function viewProject(id) {
    const d = await api('projects/' + id);
    const p = d.project;
    const tab = (location.hash.split('?')[1] || '').match(/tab=(\w+)/);
    const t = tab ? tab[1] : 'preview';
    const tabs = [['preview', 'Aperçu'], ['code', 'Code'], ['tests', 'Tests'], ['versions', 'Versions'], ['history', 'Historique']];
    if (p.type === 'api') tabs.push(['console', 'Console API']);
    if (p.type === 'agent') tabs.push(['chat', 'Discussion']);
    return shell(esc(p.name), `
      <div class="row sec"><div class="thumb" style="width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:20px;background:${p.color || '#4f7cff'}22;border:1px solid ${p.color || '#4f7cff'}55">${TYPE_ICO[p.type]}</div>
        <div style="flex:1"><div class="row"><h3 style="font-size:17px">${esc(p.name)}</h3>${statusBadge(p.status)}</div>
        <div class="muted small">${TYPE_LBL[p.type]} · v${p.current_version} · créé le ${fmt(p.created_at)}${ENGINE_LBL(p) ? ' · <span title="' + esc((p.versions || [])[ (p.versions || []).length - 1 ].engine_detail || '') + '">' + esc(ENGINE_LBL(p)) + '</span>' : ''}</div></div>
        <div class="row wrap">
          ${p.status === 'draft' || p.status === 'suspended' ? `<button class="btn sm" data-act="publish">🚀 Publier</button>` : ''}
          ${p.status === 'published' ? `<button class="btn sm ghost" data-act="unpublish">Dépublier</button>` : ''}
          <button class="btn sm ghost" data-act="modify">✏️ Modifier par description</button>
          <a class="btn sm ghost" href="/export/${p.id}.zip">⬇ Export ZIP</a>
        </div>
      </div>
      ${p.resources && p.resources.length ? `<div class="card linked-resources"><b>Ressources intégrées</b><div class="pill-row">${p.resources.map((f) => `<span class="chip">📎 ${esc(f.name)}</span>`).join('')}</div></div>` : ''}
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === t ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="ptab"></div>
    `);
  }

  function renderProjectTab(p, files, t) {
    const box = $('#ptab');
    if (t === 'chat') {
      box.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><div class="chat" style="height:calc(100vh - 320px);min-height:360px">
        <div class="msgs" id="agentMsgs"><div class="msg a">Bonjour 👋 Je suis <b>${esc(p.name)}</b>. Écrivez-moi : la réponse s’affiche au fur et à mesure de sa rédaction.</div></div>
        <div class="inbar"><input class="inp" id="agentIn" placeholder="Écrivez votre message…" autocomplete="off"><button class="btn" id="agentSend" data-stream-send>Envoyer</button><button class="btn ghost stop" id="agentStop" data-stream-stop hidden>⏹ Arrêter</button></div>
      </div></div>
      <p class="hint">L’agent utilise ses outils (calcul, date, web, serveurs MCP autorisés) et répond par-dessus. Sans fournisseur IA configuré, le moteur local NovaCore prend le relais.</p>`;
      const send = () => {
        const inp = $('#agentIn');
        const v = inp.value.trim();
        if (!v) return;
        inp.value = '';
        const msgs = $('#agentMsgs');
        msgs.insertAdjacentHTML('beforeend', `<div class="msg u">${esc(v)}</div>`);
        msgs.scrollTop = msgs.scrollHeight;
        sendStreamChat({
          url: '/api/v1/projects/' + p.id + '/chat',
          body: { message: v },
          container: msgs,
          onDone: (data, bubble) => {
            bubble.setText(data.reply || '');
            msgs.scrollTop = msgs.scrollHeight;
          },
        });
      };
      if ($('#agentSend')) $('#agentSend').onclick = send;
      if ($('#agentIn')) $('#agentIn').onkeydown = (e) => { if (e.key === 'Enter') send(); };
      if ($('#agentStop')) $('#agentStop').onclick = () => { if (N._abort) N._abort.abort(); };
      return;
    }
    if (t === 'preview') {
      if (p.type === 'app') box.innerHTML = `<div class="preview-box"><iframe src="/preview/${p.id}/?t=${Date.now()}" sandbox="allow-scripts allow-same-origin"></iframe></div><p class="hint">Aperçu en direct — l’application est réellement fonctionnelle (données stockées localement dans l’iframe).</p>`;
      else if (p.type === 'fullstack' || p.type === 'mobile') box.innerHTML = `<div class="preview-box"><iframe src="/run/${p.id}/?t=${Date.now()}" sandbox="allow-scripts allow-same-origin"></iframe></div><p class="hint">Aperçu en direct — l’app est connectée à son API (persistance serveur du projet, repli hors ligne). ${p.type === 'mobile' ? 'Le ZIP contient le projet Capacitor pour compiler l’APK.' : ''}</p>`;
      else if (p.type === 'agent') box.innerHTML = `<div class="preview-box"><iframe src="/preview/${p.id}/?t=${Date.now()}" sandbox="allow-scripts allow-same-origin"></iframe></div>`;
      else box.innerHTML = `<div class="card"><h3>API en ligne</h3><p class="muted small" style="margin:8px 0 14px">L’API générée est exécutée en direct par le runtime NovaForge. Essayez la <a href="#/projects/${p.id}?tab=console">Console API</a> ou :</p>
        <div class="pill-row"><a class="chip" href="/run/${p.id}/" target="_blank">GET /</a><a class="chip" href="/run/${p.id}/health" target="_blank">GET /health</a></div></div>
        <div class="preview-box" style="margin-top:14px"><iframe src="/run/${p.id}/" style="min-height:200px"></iframe></div>`;
      return;
    }
    if (t === 'code') {
      box.innerHTML = `<div class="row wrap sec">${files.map((f) => `<button class="chip" style="cursor:pointer" data-file="${esc(f)}">${esc(f)}</button>`).join('')}</div><pre class="code" id="codeBox">Sélectionnez un fichier…</pre>`;
      const load = async (f) => {
        try { const d = await api(`projects/${p.id}/file?name=${encodeURIComponent(f)}`); $('#codeBox').textContent = d.content; } catch (e) { toast(e.message, 'err'); }
      };
      box.querySelectorAll('[data-file]').forEach((b) => (b.onclick = () => load(b.dataset.file)));
      if (files[0]) load(files[0]);
      return;
    }
    if (t === 'tests') {
      const v = (p.versions || []).slice().reverse().find((x) => x.v === p.current_version) || {};
      box.innerHTML = `<div class="row sec" style="justify-content:flex-end"><button class="btn sm ghost" id="reTest">↻ Relancer les tests</button></div>
        <div class="grid g2">${(v.tests || []).map((x) => `<div class="card"><div class="row"><span class="badge ${x.ok ? 'ok' : 'err'}">${x.ok ? '✓ Réussi' : '✗ Échoué'}</span><b style="font-size:13.5px">${esc(x.name)}</b></div><p class="muted small" style="margin-top:8px">${esc(x.detail || '')}</p></div>`).join('') || '<p class="muted">Aucun test enregistré.</p>'}</div>`;
      if ($('#reTest')) $('#reTest').onclick = async () => {
        try { const d = await api('projects/' + p.id, { method: 'POST', body: { action: 'test' } }); toast(d.tests.every((x) => x.ok) ? 'Tous les tests passent ✓' : 'Des tests échouent', d.tests.every((x) => x.ok) ? 'ok' : 'err'); render(); }
        catch (e) { toast(e.message, 'err'); }
      };
      return;
    }
    if (t === 'versions') {
      box.innerHTML = `<table class="tbl"><thead><tr><th>Version</th><th>Note</th><th>Fichiers</th><th>Date</th><th>Tests</th><th></th></tr></thead><tbody>
        ${(p.versions || []).slice().reverse().map((v) => `<tr><td><b>v${v.v}</b> ${v.v === p.current_version ? '<span class="badge mut">actuelle</span>' : ''}</td>
        <td class="muted small">${esc(v.note || '')}</td><td>${(v.files || []).map((f) => `<span class="chip">${esc(f)}</span>`).join(' ')}</td><td class="muted small">${fmt(v.created_at)}</td>
        <td>${v.ok === false ? '<span class="badge err">échecs</span>' : '<span class="badge ok">ok</span>'}</td>
        <td>${v.v === p.current_version ? '' : `<button class="btn sm ghost" data-rest="${v.v}">Restaurer</button>`}</td></tr>`).join('')}</tbody></table>`;
      box.querySelectorAll('[data-rest]').forEach((b) => (b.onclick = async () => {
        if (!await confirmModal('Restaurer la version ' + b.dataset.rest + ' ?', 'Une nouvelle version sera créée à partir de cette version (réversible).', false)) return;
        try { const d = await api('projects/' + p.id, { method: 'POST', body: { action: 'restore', version: parseInt(b.dataset.rest) } }); toast('Version v' + d.version + ' active.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
      }));
      return;
    }
    if (t === 'history') {
      const acts = p.activity ? p.activity.slice().reverse() : [];
      box.innerHTML = acts.length ? `<div>${acts.map((a) => `<div class="card" style="padding:12px 16px;margin-bottom:8px"><div class="row"><span class="chip">${esc(a.action)}</span><span class="muted small">${fmt(a.ts)}</span></div><p class="muted small" style="margin-top:6px">${esc(a.detail || '')}</p></div>`).join('')}</div>` : '<p class="muted">Historique vide.</p>';
      return;
    }
    if (t === 'console') {
      const v = (p.versions || []).slice().reverse()[0];
      const resources = [];
      (v && v.files || []).forEach(() => { });
      box.innerHTML = `<div class="card">
        <h3>Console API (runtime en direct)</h3>
        <p class="muted small" style="margin:6px 0 14px">Ces requêtes sont réellement exécutées par la plateforme sur les données de l’API générée.</p>
        <div class="grid g2" style="grid-template-columns:150px 1fr 1.4fr">
          <div><label class="muted small">Méthode</label><select class="inp" id="cM"><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select></div>
          <div><label class="muted small">Route</label><input class="inp mono" id="cP" value="/health"></div>
          <div><label class="muted small">Corps (JSON, POST/PUT)</label><input class="inp mono" id="cB" value='{"exemple":"valeur"}'></div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn sm" id="cGo">Exécuter</button><span class="muted small" id="cInfo"></span></div>
        <pre class="code" id="cOut" style="margin-top:12px;min-height:60px">—</pre>
      </div>`;
      $('#cGo').onclick = async () => {
        const m = $('#cM').value, pp = $('#cP').value || '/', b = $('#cB').value;
        try {
          const t0 = Date.now();
          const r = await fetch('/run/' + p.id + pp, { method: m, headers: { 'Content-Type': 'application/json' }, body: ['POST', 'PUT'].includes(m) && b ? b : undefined });
          const txt = await r.text();
          let pretty = txt;
          try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch { /* ignore */ }
          $('#cOut').textContent = pretty;
          $('#cInfo').textContent = `${r.status} · ${Date.now() - t0} ms`;
        } catch (e) { $('#cOut').textContent = 'Erreur : ' + e.message; }
      };
    }
  }

  function bindProject(p) {
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => {
      document.querySelectorAll('.tabs [data-tab]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      renderProjectTab(p, (N._pfiles || []), b.dataset.tab);
    }));
    document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act;
      if (act === 'modify') {
        const desc = prompt('Décrivez la modification à apporter (regénère une nouvelle version) :');
        if (!desc) return;
        try {
          const d = await api('projects/' + p.id, { method: 'POST', body: { action: 'regenerate', description: desc } });
          toast('Nouvelle version v' + d.version + ' générée et testée.', 'ok');
          render();
        } catch (e) { toast(e.message, 'err'); }
        return;
      }
      if (act === 'publish') {
        if (p.pipeline && p.pipeline.some((s) => s.status === 'error')) {
          if (!await confirmModal('Publier malgré des tests en échec ?', 'Le projet a des avertissements de test.')) return;
        }
        try { const d = await api('projects/' + p.id, { method: 'POST', body: { action: 'publish' } }); toast(d.message || 'Projet publié.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
        return;
      }
      if (act === 'unpublish') {
        try { await api('projects/' + p.id, { method: 'POST', body: { action: 'unpublish' } }); toast('Projet dépublié.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
      }
    }));
  }

  // ---------- Fichiers importés ----------
  async function viewFiles() {
    const d = await api('uploads');
    const files = d.files || [];
    const fmtSize = (n) => n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(1) + ' Ko' : (n / 1048576).toFixed(1) + ' Mo';
    const rows = files.map((f) => {
      const id = encodeURIComponent(f.id);
      const mime = String(f.mime || '');
      const preview = mime.startsWith('image/') && ['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(mime)
        ? `<img class="file-preview" src="/api/v1/uploads/${id}/file?preview=1" alt="">`
        : mime.startsWith('video/') && ['video/mp4','video/webm','video/ogg'].includes(mime)
          ? `<video class="file-preview" controls preload="metadata" src="/api/v1/uploads/${id}/file?preview=1"></video>`
          : `<div class="file-preview file-generic">📄</div>`;
      return `<div class="file-card">
        ${preview}
        <div class="file-info"><strong title="${esc(f.name)}">${esc(f.name)}</strong>
          <span class="muted">${esc(f.mime || 'type inconnu')} · ${fmtSize(Number(f.size)||0)} · ${fmt(f.created_at)}</span>
          <div class="row file-actions">
            <a class="btn sm ghost" href="/api/v1/uploads/${id}/file">Télécharger</a>
            <button class="btn sm ghost" data-compress-file="${id}">Compresser (.gz)</button>
            ${['text/plain','text/markdown','text/csv','application/json'].includes(mime) ? `<button class="btn sm ghost" data-convert-file="${id}">Convertir en MD</button>` : ''}
            <button class="btn sm danger" data-delete-file="${id}">Supprimer</button>
          </div>
        </div>
      </div>`;
    }).join('');
    return shell('Mes fichiers', `
      <div class="page-head"><div><h3>Importer des fichiers</h3><p class="muted">Images, vidéos, audio, documents, archives ZIP et autres formats. Les fichiers sont stockés dans votre espace privé.</p></div></div>
      <div class="card file-upload-card">
        <form id="uploadForm">
          <label class="file-drop" for="fileInput">
            <span style="font-size:32px">📤</span>
            <strong>Choisir un ou plusieurs fichiers</strong>
            <span class="muted">Tous les types de fichiers sont acceptés</span>
            <input id="fileInput" type="file" multiple>
          </label>
          <div id="selectedFiles" class="hint">Aucun fichier sélectionné.</div>
          <div class="row" style="align-items:center;gap:12px;flex-wrap:wrap">
            <button class="btn" id="uploadButton" type="submit">Importer les fichiers</button>
            <span class="hint">Maximum ${fmtSize(d.max_file_bytes)} par fichier et ${fmtSize(d.max_batch_bytes)} par import · espace personnel ${fmtSize(d.quota_bytes)}</span>
          </div>
          <div id="uploadStatus" class="hint" role="status"></div>
        </form>
      </div>
      <div class="section-head"><h3>Mes fichiers (${files.length})</h3><span class="muted">Stockage privé</span></div>
      <div class="file-grid">${rows || '<div class="empty">Aucun fichier importé pour le moment.</div>'}</div>
      <p class="hint">Sécurité : les fichiers sont conservés comme données. Les archives ZIP ne sont pas extraites automatiquement et aucun fichier importé n’est exécuté.</p>
    `);
  }

  function bindFiles() {
    const input = $('#fileInput');
    const selected = $('#selectedFiles');
    const form = $('#uploadForm');
    if (input) input.onchange = () => {
      const files = Array.from(input.files || []);
      selected.textContent = files.length ? files.map((f) => `${f.name} (${(f.size / 1048576).toFixed(2)} Mo)`).join(' · ') : 'Aucun fichier sélectionné.';
    };
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const files = Array.from(input.files || []);
      if (!files.length) return toast('Choisissez au moins un fichier.', 'err');
      const fd = new FormData();
      files.forEach((file) => fd.append('files', file, file.name));
      const btn = $('#uploadButton'); btn.disabled = true; btn.textContent = 'Importation…';
      try {
        const response = await fetch('/api/v1/uploads', { method: 'POST', body: fd });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Échec de l’importation.');
        toast(data.message || 'Fichiers importés.', 'ok');
        render();
      } catch (err) {
        $('#uploadStatus').textContent = err.message;
        toast(err.message, 'err');
      } finally {
        if ($('#uploadButton')) { $('#uploadButton').disabled = false; $('#uploadButton').textContent = 'Importer les fichiers'; }
      }
    };
    document.querySelectorAll('[data-compress-file]').forEach((btn) => btn.onclick = async () => {
      btn.disabled = true;
      try { await api('uploads/' + btn.dataset.compressFile + '/transform', { method: 'POST', body: { action: 'compress_gzip' } }); toast('Copie compressée créée (.gz).', 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    });
    document.querySelectorAll('[data-convert-file]').forEach((btn) => btn.onclick = async () => {
      btn.disabled = true;
      try { await api('uploads/' + btn.dataset.convertFile + '/transform', { method: 'POST', body: { action: 'convert', format: 'md' } }); toast('Copie Markdown créée.', 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    });
    document.querySelectorAll('[data-delete-file]').forEach((btn) => btn.onclick = async () => {
      if (!await confirmModal('Supprimer ce fichier ?', 'Cette suppression est définitive.')) return;
      try { await api('uploads/' + btn.dataset.deleteFile, { method: 'DELETE' }); toast('Fichier supprimé.', 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); }
    });
  }

  // ---------- Automatisation ----------
  const TASK_ICO = { run_command: '💻', http_request: '🌐', web_fetch: '🔗', create_file: '📝', read_file: '📄', list_dir: '📂', copy_file: '📋', delete_file: '🗑', system_info: '🖥' };
  async function viewAutomation() {
    const d = await api('automation');
    const sys = d.system;
    const taskCard = (t) => `
      <div class="card" style="margin-bottom:12px">
        <div class="row"><span style="font-size:18px">${TASK_ICO[t.action && t.action.type] || '⚙️'}</span>
          <div style="flex:1;min-width:0"><b>${esc(t.name)}</b>
          <div class="muted small">${t.action ? `${esc(t.action.type)} · ${esc(JSON.stringify(t.action.params).slice(0, 90))}` : ''} ${t.kind === 'daily' ? `· chaque jour à ${t.time}` : t.at ? `· ${fmt(t.at)}` : ''}</div></div>
          <span class="badge ${t.status === 'done' ? 'ok' : t.status === 'failed' ? 'err' : t.status === 'awaiting_confirmation' ? 'warn' : t.status === 'cancelled' ? 'mut' : 'mut'}">${{ done: 'Terminée', failed: 'Échec', awaiting_confirmation: 'Confirmation requise', ready: 'Prête', running: 'En cours', cancelled: 'Annulée' }[t.status] || t.status}</span>
        </div>
        ${t.status === 'awaiting_confirmation' ? `<div class="row" style="margin-top:12px"><button class="btn sm" data-tc="${t.id}">✅ Confirmer & exécuter</button><button class="btn sm ghost" data-tcancel="${t.id}">Annuler</button></div>` : ''}
        <div class="row" style="margin-top:12px">
          ${t.kind === 'daily' || (t.kind === 'onetime' && t.status === 'ready') ? `<button class="btn sm ghost" data-trun="${t.id}">▶ Exécuter maintenant</button>` : ''}
          <button class="btn sm ghost" data-thist="${t.id}">📜 Historique (${(t.history || []).length})</button>
          <span class="sp"></span>
          <button class="btn sm danger" data-tdel="${t.id}">Supprimer</button>
        </div>
        <div id="th_${t.id}" style="display:none"></div>
      </div>`;
    return shell('Automatisation', `
      <div class="card sec" style="border-color:var(--bord2)">
        <div class="row"><span style="font-size:20px">🤖</span><div style="flex:1"><b>Nouvelle automatisation</b>
        <p class="muted small">Décrivez la tâche : « fais une requête GET https://api.example.com », « lance la commande df -h », « tous les jours à 8h visite https://monsite.cd », « crée le fichier notes.txt avec Bonjour ».</p></div></div>
        <div class="inbar" style="margin-top:12px"><input class="inp" id="autoIn" placeholder="Décrivez la tâche à automatiser…"><button class="btn" id="autoGo">Créer</button></div>
        <p class="hint" style="margin-top:10px">Exécutée sur <b>la machine où NovaForge est installée</b> (tâches en ligne : HTTP/web ; hors ligne : fichiers, commandes shell). ${d.commands_allowed ? '' : '<span class="badge err">Commandes shell désactivées par le Super Admin</span>'} Toute commande shell exige votre confirmation explicite.</p>
      </div>
      <div class="grid g4 sec">
        <div class="stat"><div class="lbl">Appareil</div><div class="val" style="font-size:16px;padding-top:6px">${esc(sys.hostname)}</div><div class="sub">${esc(sys.platform)} · ${esc(sys.arch)}</div></div>
        <div class="stat"><div class="lbl">Node.js</div><div class="val" style="font-size:16px;padding-top:6px">${esc(sys.node)}</div><div class="sub">${sys.cpus} cœurs CPU</div></div>
        <div class="stat"><div class="lbl">Mémoire</div><div class="val" style="font-size:16px;padding-top:6px">${sys.mem_free_go} / ${sys.mem_total_go} Go</div><div class="sub">libre / totale</div></div>
        <div class="stat"><div class="lbl">Uptime</div><div class="val" style="font-size:16px;padding-top:6px">${sys.uptime_h} h</div><div class="sub">depuis le redémarrage</div></div>
      </div>
      <div class="sec"><h3>Tâches</h3>${d.tasks.length ? d.tasks.map(taskCard).join('') : '<div class="empty">Aucune tâche. Décrivez la première ci-dessus.</div>'}</div>
    `);
  }

  function bindAutomation() {
    if ($('#autoGo')) $('#autoGo').onclick = async () => {
      const v = $('#autoIn').value.trim();
      if (!v) return toast('Décrivez la tâche.', 'err');
      try {
        const d = await api('automation/task', { method: 'POST', body: { description: v } });
        toast(d.needs_confirmation ? 'Tâche créée — votre confirmation est requise (commande shell).' : d.log ? 'Tâche exécutée ✓' : 'Tâche planifiée ✓', 'ok');
        render();
      } catch (e) { toast(e.message, 'err'); }
    };
    if ($('#autoIn')) $('#autoIn').onkeydown = (e) => { if (e.key === 'Enter') $('#autoGo').click(); };
    document.body.addEventListener('click', async (e) => {
      const tc = e.target.closest('[data-tc]');
      if (tc) { try { await api('automation/task/' + tc.dataset.tc, { method: 'POST', body: { action: 'confirm' } }); toast('Exécuté.', 'ok'); render(); } catch (err) { toast(err.message, 'err'); } return; }
      const tr = e.target.closest('[data-trun]');
      if (tr) { try { const d = await api('automation/task/' + tr.dataset.trun, { method: 'POST', body: { action: 'run' } }); if (d.needs_confirmation || (d.error && /confirmation/i.test(d.error))) render(); else toast(d.ok ? 'Exécution terminée ✓' : 'Échec', d.ok ? 'ok' : 'err'); render(); } catch (err) { toast(err.message, 'err'); } return; }
      const tca = e.target.closest('[data-tcancel]');
      if (tca) { try { await api('automation/task/' + tca.dataset.tcancel, { method: 'POST', body: { action: 'cancel' } }); render(); } catch (err) { toast(err.message, 'err'); } return; }
      const th = e.target.closest('[data-thist]');
      if (th) {
        const box = $('#th_' + th.dataset.thist);
        if (box.style.display !== 'none') { box.style.display = 'none'; return; }
        box.style.display = 'block';
        box.innerHTML = '<p class="muted small">Chargement…</p>';
        try {
          const d = await api('automation');
          const t = d.tasks.find((x) => x.id === parseInt(th.dataset.thist));
          box.innerHTML = (t.history || []).slice().reverse().map((h) => `<div class="card" style="padding:10px 14px;margin-bottom:8px"><div class="row"><span class="badge ${h.status === 'done' ? 'ok' : 'err'}">${h.status}</span><span class="muted small">${fmt(h.ts)} ${h.confirmed ? '· confirmé' : ''}</span></div><pre class="code" style="margin-top:8px;max-height:160px">${esc(h.log || '—')}</pre></div>`).join('') || '<p class="muted small">Aucun historique.</p>';
        } catch (err) { box.innerHTML = esc(err.message); }
        return;
      }
      const td = e.target.closest('[data-tdel]');
      if (td) {
        if (!await confirmModal('Supprimer cette tâche ?', 'L’historique sera perdu.')) return;
        try { await api('automation/task/' + td.dataset.tdel, { method: 'POST', body: { action: 'delete', confirmed: true } }); render(); } catch (err) { toast(err.message, 'err'); }
      }
    });
  }

  // ---------- Billing ----------
  async function viewBilling() {
    const [plans, me, gwr] = await Promise.all([api('plans'), api('billing/me'), api('billing/gateway')]);
    const gw = (gwr && gwr.gateway) || { available: false };
    N._payPayments = me.payments || [];
    const gwPending = N._payPayments.find((p) => p.method === 'gateway' && p.status === 'pending' && p.checkout_url);
    const step = (N._payStep || 0);
    let paySection = '';
    if (step === 1) {
      const plan = plans.plans.find((p) => p.id === N._payPlan);
      const cfg = (plans.payment || {})[N._payMethod] || {};
      paySection = `<div class="card sec">
        <div class="steps"><div class="s on"><b>1</b>Offre</div><div class="s on"><b>2</b>Paiement</div><div class="s"><b>3</b>Validation</div></div>
        <h3>Paiement manuel — ${esc(plan.name)} (${money(plan.price)}/mois)</h3>
        <div class="card" style="background:var(--bg2);margin:14px 0">
          <div class="row"><b style="font-size:17px">${{ mpesa: '📱 M-Pesa', orange: '🟠 Orange Money', airtel: '🔴 Airtel Money' }[N._payMethod]}</b><span class="sp"></span>${cfg.number ? `<span class="badge grad">N° : ${esc(cfg.number)}</span>` : '<span class="badge warn">Le numéro de réception n’a pas encore été configuré par le Super Admin</span>'}</div>
          <p class="muted small" style="margin-top:10px">${esc(cfg.instructions || 'Suivez les instructions configurées par l’administrateur.')}</p>
        </div>
        <div class="grid g2">
          <div class="field"><label>Référence de la transaction *</label><input class="inp" id="payRef" placeholder="Ex. : M240512345678"></div>
          <div class="field"><label>Nom du numéro payeur *</label><input class="inp" id="payNote" placeholder="Ex. : Aïcha M."></div>
        </div>
        <div class="field"><label>Preuve de paiement (capture d’écran, optionnel — 4 Mo max)</label><input class="inp" type="file" id="payProof" accept="image/*"></div>
        <div class="row"><button class="btn" id="paySubmit">Envoyer pour validation</button><button class="btn ghost" id="payBack">← Retour</button></div>
      </div>`;
    }
    const pending = me.payments.find((p) => p.status === 'pending' && p.method !== 'gateway');
    const statusBadgePay = (s) => s === 'validated' ? '<span class="badge ok">Validé</span>' : s === 'rejected' ? `<span class="badge err">Rejeté</span>` : s === 'cancelled' ? '<span class="badge mut">Annulé</span>' : '<span class="badge warn">En attente de validation</span>';
    const gwBadge = (s) => s === 'validated' ? '<span class="badge ok">Payé — activé ✓</span>' : s === 'failed' ? '<span class="badge err">Échec du paiement</span>' : s === 'mismatch' ? '<span class="badge err">Montant non conforme</span>' : '<span class="badge warn">En attente du paiement…</span>';
    return shell('Abonnement & paiements', `
      <div class="card sec" style="border-color:var(--bord2)"><div class="row"><b>Plan actuel : ${esc(me.plan.name)}</b><span class="sp"></span>${me.subscription && me.subscription.expires_at ? `<span class="muted small">expire le ${fmt(me.subscription.expires_at)}</span>` : '<span class="muted small">sans expiration</span>'}</div></div>
      <div class="grid g4 sec">${plans.plans.map((p) => `
        <div class="plan ${p.id === me.plan.id ? 'best' : ''}">
          ${p.id === me.plan.id ? '<span class="badge grad" style="position:absolute;top:14px;right:14px">Actuel</span>' : ''}
          <h4>${esc(p.name)}</h4>
          <div class="price">${money(p.price)}<small> /mois</small></div>
          <ul>${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}
            <li>${p.creations_per_day >= 1000 ? 'Créations sans quota journalier commercial fixe (usage équitable)' : p.creations_per_day + ' créations/jour'}</li>
            <li>${p.apps_per_day >= 100 ? 'Limites techniques de sécurité incluses' : 'Max ' + p.apps_per_day + ' application(s)/jour'}</li>
          </ul>
          ${p.price > 0 && p.id !== me.plan.id ? `<button class="btn ${p.id === 'premium_soft' ? 'grad' : 'ghost'} block" data-choose="${p.id}">Choisir ${esc(p.name)}</button>` : p.price === 0 ? '<button class="btn ghost block" disabled>Plan de base</button>' : '<button class="btn ghost block" disabled>Plan actuel</button>'}
          ${p.price > 0 && p.id !== me.plan.id && gw.available ? `<button class="btn ghost block" style="margin-top:6px" data-gwbuy="${p.id}">💳 Payer par ${esc(gw.type_label)}</button>` : ''}
        </div>`).join('')}</div>
      ${paySection}
      ${gw.available ? `<div class="card sec" style="border-color:rgba(96,165,250,.4)"><div class="row"><div style="flex:1"><h3>💳 Paiement automatique — ${esc(gw.name)}</h3>
        <p class="muted small" style="margin-top:8px">Passerelle en devise <b>${esc(gw.currency)}</b>${gw.price_multiplier && gw.price_multiplier !== 1 ? ` (montant facturé = prix du plan × ${esc(gw.price_multiplier)})` : ''}. Vous êtes redirigé vers la page de paiement du prestataire ; l’abonnement <b>${esc(gw.type_label)}</b> s’active automatiquement dès que la passerelle confirme la transaction (notification signée). Aucun intermédiaire ne peut activer un abonnement sans ce retour signé.</p></div></div></div>` : ''}
      ${gwPending ? `<div class="card sec" style="border-color:rgba(251,191,36,.45)"><h3>💳 Paiement en cours chez ${esc(gwPending.gateway_type || 'la passerelle')}</h3>
        <p class="muted small" style="margin:8px 0">Référence <b class="mono">${esc(gwPending.reference)}</b> · montant ${money(gwPending.amount)} ${esc(gwPending.currency || '')} · offre ${esc(gwPending.plan_id)}. L’abonnement s’active automatiquement dès que la passerelle confirme le paiement.</p>
        <button class="btn sm" data-gwresume="${gwPending.id}">Reprendre le paiement</button></div>` : ''}
      ${pending ? `<div class="card sec" style="border-color:rgba(251,191,36,.45)"><h3>💡 Demande en attente de validation</h3>
        <p class="muted small" style="margin:8px 0">Référence <b class="mono">${esc(pending.reference)}</b> via ${esc(pending.method)} pour le plan ${esc(pending.plan_id)}. <b>L’abonnement ne devient actif qu’après validation explicite du Super Admin</b> (aucune activation automatique).</p>
        <button class="btn sm ghost" data-cancelPay="${pending.id}">Annuler cette demande</button></div>` : ''}
      <div class="grid g2 sec">
        <div class="card"><h3 style="margin-bottom:12px">Mes demandes de paiement</h3>
          <table class="tbl"><thead><tr><th>Plan</th><th>Méthode</th><th>Réf.</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead><tbody>
          ${me.payments.map((p) => `<tr><td>${esc(p.plan_id)}</td><td>${p.method === 'gateway' ? '🏦 ' + esc(p.gateway_type || 'passerelle') : esc(p.method)}</td><td class="mono">${esc(p.reference)}</td>
          <td>${p.amount != null ? money(p.amount) + (p.currency ? ' ' + esc(p.currency) : '') : '—'}${p.commission != null ? `<div class="muted small">brut ${money(p.gross)} · commission ${money(p.commission)} · net ${money(p.net)}</div>` : ''}</td>
          <td>${p.method === 'gateway' ? gwBadge(p.status) : statusBadgePay(p.status)}</td><td class="muted small">${fmt(p.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucune demande.</td></tr>'}</tbody></table>
        </div>
        <div class="card"><h3 style="margin-bottom:12px">💰 Revenus (projets publiés) — commission plateforme ${Math.round((me.totals && me.totals.fee ? 0 : 0.1) * 100)}%</h3>
          <div class="grid g3" style="margin-bottom:12px">
            <div class="stat"><div class="lbl">Brut</div><div class="val" style="font-size:20px">${money(me.totals.gross)}</div></div>
            <div class="stat"><div class="lbl">Commission (10 %)</div><div class="val" style="font-size:20px;color:var(--warn)">${money(me.totals.fee)}</div></div>
            <div class="stat"><div class="lbl">Net créateur</div><div class="val" style="font-size:20px;color:var(--ok)">${money(me.totals.net)}</div></div>
          </div>
          <table class="tbl"><thead><tr><th>Projet</th><th>Brut</th><th>Commission</th><th>Net</th></tr></thead><tbody>
          ${me.transactions.map((t) => `<tr><td>${esc(t.note || ('Projet #' + t.project_id))}</td><td>${money(t.gross)}</td><td style="color:var(--warn)">${money(t.fee)}</td><td style="color:var(--ok)"><b>${money(t.net)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune transaction enregistrée pour l’instant. Les transactions réelles des créations publiées y apparaîtront (aucune simulation).</td></tr>'}</tbody></table>
        </div>
      </div>
    `);
  }

  function bindBilling(plans) {
    document.querySelectorAll('[data-gwbuy]').forEach((b) => (b.onclick = async () => {
      b.innerHTML = '<span class="spin"></span> Initialisation…';
      try {
        const d = await api('billing/gateway/checkout', { method: 'POST', body: { plan_id: b.dataset.gwbuy } });
        const url = d.payment && d.payment.checkout_url;
        if (!url) return toast('Lien de paiement indisponible — réessayez.', 'err');
        toast(d.reused ? 'Paiement déjà initialisé — redirection…' : 'Redirection vers la page de paiement…', 'ok');
        setTimeout(() => { location.href = url; }, 500);
      } catch (e) { toast(e.message, 'err'); render(); }
    }));
    document.querySelectorAll('[data-gwresume]').forEach((b) => (b.onclick = () => {
      const p = (N._payPayments || []).find((x) => x.id === parseInt(b.dataset.gwresume));
      if (p && p.checkout_url) location.href = p.checkout_url;
      else toast('Lien de paiement indisponible.', 'err');
    }));
    document.querySelectorAll('[data-choose]').forEach((b) => (b.onclick = () => {
      N._payPlan = b.dataset.choose;
      N._payStep = 0.5;
      const method = prompt('Moyen de paiement :\n1 — M-Pesa\n2 — Orange Money\n3 — Airtel Money\n\nChoisissez (1/2/3) :');
      const m = { '1': 'mpesa', '2': 'orange', '3': 'airtel' }[method];
      if (!m) { N._payStep = 0; return toast('Choix invalide — annulé.', 'err'); }
      N._payMethod = m;
      N._payStep = 1;
      render();
    }));
    if ($('#payBack')) $('#payBack').onclick = () => { N._payStep = 0; render(); };
    if ($('#paySubmit')) $('#paySubmit').onclick = async () => {
      const ref = $('#payRef').value.trim();
      const note = $('#payNote').value.trim();
      if (!ref || !note) return toast('Référence et nom du payeur requis.', 'err');
      let proof = '';
      const f = $('#payProof').files[0];
      if (f) proof = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(f); });
      try {
        await api('billing/payment', { method: 'POST', body: { plan_id: N._payPlan, method: N._payMethod, reference: ref, note, proof_base64: proof || undefined } });
        N._payStep = 0;
        toast('Demande envoyée — en attente de validation du Super Admin.', 'ok');
        render();
      } catch (e) { toast(e.message, 'err'); }
    };
    document.querySelectorAll('[data-cancelPay]').forEach((b) => (b.onclick = async () => {
      if (!await confirmModal('Annuler cette demande de paiement ?', '')) return;
      try { await api('billing/payment/' + b.dataset.cancelPay + '/cancel', { method: 'POST' }); render(); } catch (e) { toast(e.message, 'err'); }
    }));
  }

  // ---------- Orchestration IA ----------
  const PROV_TYPES = [
    ['openai', 'OpenAI'], ['openrouter', 'OpenRouter'], ['anthropic', 'Anthropic (Claude)'], ['ollama', 'Ollama (local)'], ['custom', 'Compatible OpenAI (autre)'],
  ];
  const PROV_DEF = { openai: 'https://api.openai.com/v1', openrouter: 'https://openrouter.ai/api/v1', anthropic: 'https://api.anthropic.com', ollama: 'http://127.0.0.1:11434/v1', custom: '' };
  async function viewProviders() {
    const [d, usage] = await Promise.all([api('providers'), api('usage')]);
    const stBadge = (p) => ({
      active: '<span class="badge ok">✓ Connecté & testé</span>',
      error: `<span class="badge err">✗ Erreur : ${esc((p.last_error || '').slice(0, 60))}</span>`,
      unconfigured: '<span class="badge mut">Non configuré</span>',
      untested: '<span class="badge warn">Non testé</span>',
    }[p.status] || `<span class="badge mut">${esc(p.status)}</span>`);
    const isAdmin = N.user.role !== 'user';
    return shell('Orchestration multi-IA', `
      <div class="card sec">
        <div class="row"><div style="flex:1"><h3>Fournisseurs de modèles</h3>
        <p class="muted small">Aucun fournisseur n’est considéré « connecté » tant que son test réel n’a pas réussi. Les clés restent côté serveur (jamais exposées au navigateur). La bascule automatique n’a lieu qu’en cas d’erreur du fournisseur sélectionné.</p></div>
        ${isAdmin ? '<button class="btn sm" id="addProv">＋ Ajouter un fournisseur</button>' : ''}</div>
        <div style="margin-top:14px">
        ${d.providers.map((p) => `<div class="card" style="margin-bottom:10px">
          <div class="row"><b>${esc(p.name)}</b><span class="chip">${esc(p.type)}</span><span class="muted small mono">${esc(p.base_url || '')}</span><span class="sp"></span>${stBadge(p)}${p.enabled === false ? '<span class="badge mut">désactivé</span>' : ''}</div>
          <div class="muted small" style="margin:8px 0">Modèles : ${(p.models || []).map(esc).join(', ') || '—'} ${p.has_key ? `· clé ${esc(p.key_hint)}` : '· <span class="badge warn">clé manquante</span>'}</div>
          ${isAdmin ? `<div class="row wrap"><button class="btn sm ghost" data-ptest="${p.id}">🔍 Tester la connexion</button><button class="btn sm ghost" data-ptog="${p.id}">${p.enabled === false ? 'Activer' : 'Désactiver'}</button><button class="btn sm ghost" data-pedit="${p.id}">Éditer</button><button class="btn sm danger" data-pdel="${p.id}">Supprimer</button></div>` : ''}
        </div>`).join('') || '<div class="empty">Aucun fournisseur configuré. Sans fournisseur, l’assistant et les agents utilisent le moteur local NovaCore (fonctionnement de base garanti, sans clé API).</div>'}</div>
      </div>
      ${isAdmin ? `<div id="provForm" style="display:none"><div class="card sec">
        <h3 id="provFormTitle">Ajouter un fournisseur</h3>
        <p class="muted small" style="margin-bottom:12px">🔑 <b>La clé API est le seul champ obligatoire.</b> Le nom, l’URL et les modèles sont facultatifs — des valeurs par défaut intelligentes sont appliquées selon le type.</p>
        <div class="grid g2">
          <div class="field"><label>Clé API * (stockée côté serveur uniquement)</label><input class="inp mono" id="pKey" placeholder="sk-…" autocomplete="off"></div>
          <div class="field"><label>Type (détermine les valeurs par défaut)</label><select class="inp" id="pType">${PROV_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          <div class="field"><label>Nom (facultatif)</label><input class="inp" id="pName" placeholder="ex. : OpenAI prod — défaut : nom du type"></div>
          <div class="field"><label>URL de base (facultatif — auto selon le type)</label><input class="inp mono" id="pBase" placeholder="défaut automatique"></div>
          <div class="field"><label>Modèles (facultatif — défaut selon le type)</label><input class="inp mono" id="pModels" placeholder="ex. : gpt-4o, gpt-4o-mini"></div>
          <div class="field"><label>Ordre de bascule (0 = priorité)</label><input class="inp" type="number" id="pOrder" value="0" min="0"></div>
        </div>
        <div class="row"><button class="btn" id="pSave">Enregistrer</button><button class="btn ghost" id="pCancel">Annuler</button></div>
      </div></div>` : ''}
      <div class="card sec">
        <h3>Mon modèle par défaut (utilisé par l’assistant et vos agents)</h3>
        <div class="grid g2" style="margin-top:10px">
          <div class="field"><label>Fournisseur</label><select class="inp" id="defProv"><option value="">Moteur local NovaCore</option>${d.providers.filter((p) => p.enabled).map((p) => `<option value="${p.id}" ${d.default.provider_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Modèle</label><input class="inp mono" id="defModel" value="${esc(d.default.model || '')}" placeholder="ex. gpt-4o"></div>
        </div>
        <button class="btn sm" id="defSave">Enregistrer mon choix</button>
      </div>
      <div class="card sec"><h3>Consommation (suivi des appels)</h3>
        <div class="row" style="margin:10px 0"><span class="chip">Appels : ${usage.totals.calls}</span><span class="chip">Tokens entrée : ${usage.totals.input}</span><span class="chip">Tokens sortie : ${usage.totals.output}</span></div>
        <table class="tbl"><thead><tr><th>Quand</th><th>Fournisseur</th><th>Modèle</th><th>Usage</th><th>Objet</th><th>Appel</th></tr></thead><tbody>
        ${usage.rows.map((x) => `<tr><td class="muted small">${fmt(x.at)}</td><td>${esc(x.provider)}</td><td class="mono small">${esc(x.model)}</td><td class="small">${x.input_tokens} → ${x.output_tokens}</td><td class="muted small">${esc(x.purpose || '')}</td><td class="mono small">${esc(x.email || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun appel LLM pour l’instant (le moteur local ne consomme pas de tokens).</td></tr>'}</tbody></table>
      </div>
    `);
  }

  function bindProviders() {
    if ($('#defSave')) $('#defSave').onclick = async () => {
      try { await api('settings/model', { method: 'POST', body: { provider_id: $('#defProv').value || null, model: $('#defModel').value || null } }); toast('Modèle par défaut enregistré.', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
    if ($('#addProv')) $('#addProv').onclick = () => {
      $('#provForm').style.display = 'block';
      $('#provFormTitle').textContent = 'Ajouter un fournisseur';
      N._editProv = null;
      $('#provForm').scrollIntoView({ behavior: 'smooth' });
    };
    if ($('#pType')) $('#pType').onchange = () => { $('#pBase').value = PROV_DEF[$('#pType').value] || ''; };
    if ($('#pSave')) $('#pSave').onclick = async () => {
      try {
        const body = { name: $('#pName').value.trim(), type: $('#pType').value, base_url: $('#pBase').value.trim(), api_key: $('#pKey').value, models: $('#pModels').value.trim(), order: $('#pOrder').value };
        if (!body.api_key && body.type !== 'ollama' && !N._editProv) return toast('La clé API est requise (sauf Ollama).', 'err');
        if (N._editProv) await api('providers/' + N._editProv, { method: 'POST', body: { action: 'update', ...body } });
        else await api('providers', { method: 'POST', body });
        toast('Fournisseur enregistré (défauts appliqués si champs vides). Lancez un test de connexion pour vérifier.', 'ok');
        render();
      } catch (e) { toast(e.message, 'err'); }
    };
    if ($('#pCancel')) $('#pCancel').onclick = () => ($('#provForm').style.display = 'none');
    document.body.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-ptest]');
      if (t) {
        t.innerHTML = '<span class="spin"></span> Test en cours…';
        try {
          const d = await api('providers/' + t.dataset.ptest, { method: 'POST', body: { action: 'test' } });
          toast(d.ok ? 'Connexion réussie — fournisseur actif ✓' : 'Test échoué : ' + (d.error || ''), d.ok ? 'ok' : 'err');
          render();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      const tg = e.target.closest('[data-ptog]');
      if (tg) { try { await api('providers/' + tg.dataset.ptog, { method: 'POST', body: { action: 'toggle' } }); render(); } catch (err) { toast(err.message, 'err'); } return; }
      const ed = e.target.closest('[data-pedit]');
      if (ed) {
        const d = await api('providers');
        const p = d.providers.find((x) => x.id === parseInt(ed.dataset.pedit));
        if (!p) return;
        N._editProv = p.id;
        $('#provForm').style.display = 'block';
        $('#provFormTitle').textContent = 'Éditer : ' + p.name;
        $('#pName').value = p.name; $('#pType').value = p.type; $('#pBase').value = p.base_url; $('#pModels').value = (p.models || []).join(', '); $('#pOrder').value = p.order;
        $('#provForm').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const dl = e.target.closest('[data-pdel]');
      if (dl) {
        if (!await confirmModal('Supprimer ce fournisseur ?', 'Les clés associées seront supprimées du serveur.')) return;
        try { await api('providers/' + dl.dataset.pdel, { method: 'POST', body: { action: 'delete', confirmed: true } }); render(); } catch (err) { toast(err.message, 'err'); }
      }
    });
  }

  // ---------- MCP ----------
  async function viewMcp() {
    const d = await api('mcp');
    const stBadge = (s) => ({ active: '<span class="badge ok">✓ Actif</span>', error: `<span class="badge err">✗ ${esc((s.last_error || '').slice(0, 50))}</span>`, untested: '<span class="badge warn">Non testé</span>' }[s.status] || '<span class="badge mut">' + esc(s.status) + '</span>');
    return shell('Gestionnaire MCP', `
      <div class="card sec"><div class="row"><div style="flex:1"><h3>Serveurs Model Context Protocol</h3>
      <p class="muted small">Ajoutez vos propres serveurs MCP (URL + authentification). Les secrets sont stockés côté serveur et jamais renvoyés au navigateur. Les agents IA utilisent les outils MCP que vous autorisez.</p></div>
      <button class="btn sm" id="addMcp">＋ Ajouter un serveur</button></div></div>
      ${d.servers.map((s) => `
        <div class="card sec" style="margin-bottom:14px">
          <div class="row"><b style="font-size:15px">${esc(s.name)}</b>${stBadge(s)}${s.enabled === false ? '<span class="badge mut">désactivé</span>' : ''}<span class="sp"></span></div>
          <p class="muted small mono" style="margin:6px 0">${esc(s.url)} · auth : ${esc(s.auth_method)} ${s.has_secret ? '· ' + esc(s.secret_hint) : '· <span class="badge warn">aucun secret</span>'}</p>
          <div class="row wrap" style="margin-top:10px">
            <button class="btn sm ghost" data-mtest="${s.id}">🔍 Tester</button>
            <button class="btn sm ghost" data-mtog="${s.id}">${s.enabled === false ? 'Activer' : 'Désactiver'}</button>
            <button class="btn sm danger" data-mdel="${s.id}">Supprimer</button>
          </div>
          ${(s.tools || []).length ? `<div style="margin-top:12px"><b class="small">Outils (${s.tools.length})</b>
            <div class="pill-row" style="margin-top:8px">${s.tools.map((t) => `<label class="chip" style="cursor:pointer;gap:7px"><input type="checkbox" data-mtool="${s.id}:${esc(t.name)}" ${t.allowed !== false ? 'checked' : ''} style="width:auto">${esc(t.name)}</label>`).join('')}</div>
            <p class="hint">Cochez les outils que vos agents sont autorisés à appeler.</p></div>` : '<p class="hint">Aucun outil détecté — testez la connexion.</p>'}
        </div>`).join('') || '<div class="empty sec">Aucun serveur MCP.</div>'}
      <div id="mcpForm" style="display:none"><div class="card sec">
        <h3>Ajouter un serveur MCP</h3>
        <div class="grid g2">
          <div class="field"><label>Nom</label><input class="inp" id="mName" placeholder="Mon serveur MCP"></div>
          <div class="field"><label>URL de connexion (http/https)</label><input class="inp mono" id="mUrl" placeholder="https://mcp.monservice.com/sse"></div>
          <div class="field"><label>Méthode d’authentification</label><select class="inp" id="mAuth"><option value="none">Aucune</option><option value="bearer">Bearer Token</option><option value="api_key">API Key (header)</option><option value="custom_header">Header personnalisé</option></select></div>
          <div class="field" id="mHdrWrap" style="display:none"><label>Nom du header</label><input class="inp mono" id="mHdr" placeholder="X-Auth-Token"></div>
          <div class="field"><label>Identifiant / secret (jamais exposé au navigateur)</label><input class="inp mono" id="mKey" type="password" autocomplete="off" placeholder="••••"></div>
        </div>
        <div class="row"><button class="btn" id="mSave">Ajouter & tester</button><button class="btn ghost" id="mCancel">Annuler</button></div>
      </div></div>
    `);
  }

  function bindMcp() {
    if ($('#addMcp')) $('#addMcp').onclick = () => { $('#mcpForm').style.display = 'block'; $('#mcpForm').scrollIntoView({ behavior: 'smooth' }); };
    if ($('#mAuth')) $('#mAuth').onchange = () => { $('#mHdrWrap').style.display = $('#mAuth').value === 'custom_header' ? 'block' : 'none'; };
    if ($('#mCancel')) $('#mCancel').onclick = () => ($('#mcpForm').style.display = 'none');
    if ($('#mSave')) $('#mSave').onclick = async () => {
      $('#mSave').innerHTML = '<span class="spin"></span> Connexion…';
      try {
        const d = await api('mcp/server', { method: 'POST', body: { name: $('#mName').value, url: $('#mUrl').value, auth_method: $('#mAuth').value, auth_header: $('#mHdr').value, auth_value: $('#mKey').value } });
        toast(d.test.ok ? 'Serveur connecté — ' + (d.test.tools || []).length + ' outil(s) détecté(s) ✓' : 'Ajouté, mais test échoué : ' + (d.test.error || ''), d.test.ok ? 'ok' : 'err');
        render();
      } catch (e) { toast(e.message, 'err'); $('#mSave').textContent = 'Ajouter & tester'; }
    };
    document.body.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-mtest]');
      if (t) {
        t.innerHTML = '<span class="spin"></span> Test…';
        try {
          const d = await api('mcp/server/' + t.dataset.mtest, { method: 'POST', body: { action: 'test' } });
          toast(d.ok ? 'Connexion réussie ✓' : 'Échec : ' + (d.error || ''), d.ok ? 'ok' : 'err');
          render();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      const tg = e.target.closest('[data-mtog]');
      if (tg) { try { await api('mcp/server/' + tg.dataset.mtog, { method: 'POST', body: { action: 'toggle' } }); render(); } catch (err) { toast(err.message, 'err'); } return; }
      const dl = e.target.closest('[data-mdel]');
      if (dl) {
        if (!await confirmModal('Supprimer ce serveur MCP ?', 'Le secret associé sera supprimé.')) return;
        try { await api('mcp/server/' + dl.dataset.mdel, { method: 'POST', body: { action: 'delete', confirmed: true } }); render(); } catch (err) { toast(err.message, 'err'); }
      }
    });
    document.body.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-mtool]');
      if (!c) return;
      const [sid, name] = c.dataset.mtool.split(':');
      try { await api('mcp/server/' + parseInt(sid), { method: 'POST', body: { action: 'tool', tool_name: name, allowed: c.checked } }); toast('Autorisation mise à jour.', 'ok'); } catch (err) { toast(err.message, 'err'); }
    });
  }

  // ---------- Admin ----------
  const PERM_LBL = {
    'users.manage': 'Gérer les utilisateurs', 'users.block': 'Bloquer/débloquer', 'users.delete': 'Supprimer des comptes',
    'subadmins.manage': 'Gérer les sous-admins', 'projects.moderate': 'Modérer les projets', 'billing.manage': 'Valider les paiements',
    'payments.manage': 'Configurer les paiements', 'plans.manage': 'Modifier les tarifs & quotas', 'providers.manage': 'Gérer les fournisseurs IA',
    'mcp.manage': 'Gérer les MCP globaux', 'automation.manage': 'Gérer l’automatisation', 'transactions.manage': 'Enregistrer des transactions',
    'settings.manage': 'Paramètres plateforme', 'logs.view': 'Consulter les journaux',
  };
  async function viewAdmin() {
    if (N.user.role !== 'super_admin') return shell('Administration', '<div class="empty">🔒 Cette zone est réservée au <b>Super Admin</b> (propriétaire de la plateforme).</div>');
    const tab = (location.hash.split('?')[1] || '').match(/tab=(\w+)/);
    const t = tab ? tab[1] : 'overview';
    const tabs = [['overview', '📊 Vue d’ensemble'], ['users', '👥 Utilisateurs'], ['payments', '💳 Paiements'], ['gateways', '🏦 Passerelle'], ['projects', '🕵️ Modération'], ['plans', '🏷️ Tarifs & quotas'], ['settings', '⚙️ Paramètres'], ['logs', '📜 Journaux']];
    let body = '';
    if (t === 'overview') {
      const s = await api('admin/stats');
      body = `<div class="grid g4 sec">
        <div class="stat"><div class="lbl">Utilisateurs</div><div class="val">${s.users.total}</div><div class="sub">${s.users.active} actifs · ${s.users.admins} admin(s)</div></div>
        <div class="stat"><div class="lbl">Projets</div><div class="val">${s.projects.total}</div><div class="sub">${s.projects.published} publiés · ${s.projects.suspended} suspendus</div></div>
        <div class="stat"><div class="lbl">À modérer</div><div class="val">${s.projects.in_moderation}</div><div class="sub">en attente de validation</div></div>
        <div class="stat"><div class="lbl">Paiements</div><div class="val">${s.payments.pending}</div><div class="sub">en attente · ${s.payments.validated} validés</div></div>
      </div>
      <div class="grid g3 sec">
        <div class="stat"><div class="lbl">Appels IA</div><div class="val">${s.usage.calls}</div><div class="sub">${s.usage.input + s.usage.output} tokens cumulés</div></div>
        <div class="stat"><div class="lbl">Tâches d’automatisation</div><div class="val">${s.automation.tasks}</div><div class="sub">créées par tous les utilisateurs</div></div>
        <div class="stat"><div class="lbl">Sauvegarde</div><div class="val" style="font-size:15px;padding-top:8px"><button class="btn sm ghost" id="doBackup">💾 Sauvegarder la base</button></div><div class="sub">snapshot restaurable</div></div>
      </div>`;
      if ($('#doBackup')) $('#doBackup').onclick = async () => { try { const d = await api('admin/backup', { method: 'POST' }); toast('Sauvegarde : ' + d.file, 'ok'); } catch (e) { toast(e.message, 'err'); } };
    }
    if (t === 'users') {
      const s = await api('admin/users');
      body = `<table class="tbl"><thead><tr><th>Email</th><th>Rôle</th><th>Plan</th><th>Statut</th><th>Inscrit</th><th>Actions</th></tr></thead><tbody>
      ${s.users.map((u) => `<tr>
        <td>${esc(u.email)} ${u.id === N.user.id ? '<span class="badge mut">vous</span>' : ''}</td>
        <td>${u.role === 'super_admin' ? '<span class="badge grad">Super Admin</span>' : u.role === 'sub_admin' ? `<span class="badge warn">Sous-admin</span> <span class="muted small">(${(u.permissions || []).length} perms)</span>` : '<span class="badge mut">Utilisateur</span>'}</td>
        <td>${esc(u.plan_id || 'free')}</td>
        <td>${u.blocked ? '<span class="badge err">bloqué</span>' : '<span class="badge ok">actif</span>'}</td>
        <td class="muted small">${fmt(u.created_at)}</td>
        <td><div class="row wrap" style="gap:6px">
          ${u.role !== 'super_admin' ? `<button class="btn sm ghost" data-uact="${u.id}:block" ${u.blocked ? 'style="display:none"' : ''}>Bloquer</button><button class="btn sm ghost" data-uact="${u.id}:unblock" ${u.blocked ? '' : 'style="display:none"'}>Débloquer</button>` : ''}
          ${N.user.role === 'super_admin' && u.role !== 'super_admin' ? `<button class="btn sm ghost" data-uact="${u.id}:sub">Sous-admin</button><button class="btn sm ghost" data-uact="${u.id}:user">→ Utilisateur</button>` : ''}
          ${u.role !== 'super_admin' ? `<button class="btn sm danger" data-uact="${u.id}:delete">Supprimer</button>` : ''}
        </div></td></tr>`).join('')}</tbody></table>`;
      N._permUser = null;
      document.body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-uact]');
        if (!b) return;
        const [id, act] = b.dataset.uact.split(':');
        if (act === 'sub') {
          const s = await api('admin/settings');
          const perms = s.permissions.filter((p) => confirm(`Accorder : ${PERM_LBL[p] || p} ?`));
          try {
            await api('admin/users/' + id, { method: 'POST', body: { action: 'role', role: 'sub_admin' } });
            if (perms.length) await api('admin/users/' + id, { method: 'POST', body: { action: 'permissions', permissions: perms } });
            toast('Rôles et permissions mis à jour.', 'ok'); render();
          } catch (err) { toast(err.message, 'err'); }
          return;
        }
        const map = { block: 'Bloquer', unblock: 'Débloquer', delete: 'SUPPRIMER DÉFINITIVEMENT', user: 'Réduire à utilisateur' };
        if (!await confirmModal(map[act] + ' cet utilisateur ?', act === 'delete' ? 'Le compte, ses projets et ses données seront supprimés.' : '')) return;
        try { await api('admin/users/' + id, { method: 'POST', body: { action: act, confirmed: true } }); toast('Fait.', 'ok'); render(); } catch (err) { toast(err.message, 'err'); }
      }, { once: false });
    }
    if (t === 'payments') {
      const s = await api('admin/payments');
      body = `<table class="tbl"><thead><tr><th>Utilisateur</th><th>Plan</th><th>Méthode</th><th>Référence</th><th>Payer pour</th><th>Statut</th><th>Note admin</th><th>Actions</th></tr></thead><tbody>
      ${s.payments.map((p) => `<tr><td>${esc(p.user_email)}</td><td><b>${esc(p.plan_id)}</b></td><td>${esc(p.method)}</td><td class="mono">${esc(p.reference)}</td><td>${esc(p.note || '')}</td>
      <td>${p.status === 'validated' ? '<span class="badge ok">Validé</span>' : p.status === 'rejected' ? '<span class="badge err">Rejeté</span>' : p.status === 'cancelled' ? '<span class="badge mut">Annulé</span>' : '<span class="badge warn">EN ATTENTE</span>'}</td>
      <td class="muted small">${esc(p.admin_note || '')}</td>
      <td>${p.status === 'pending' ? `<button class="btn sm" data-payact="${p.id}:validate">✅ Valider</button> <button class="btn sm danger" data-payact="${p.id}:reject">✗ Rejeter</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun paiement.</td></tr>'}</tbody></table>
      <p class="hint">L’abonnement n’est activé que par votre validation explicite (30 jours). Aucune activation automatique.</p>`;
      document.body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-payact]');
        if (!b) return;
        const [id, act] = b.dataset.payact.split(':');
        const note = act === 'validate' ? 'OK' : (prompt('Motif du rejet :') || '');
        try { await api('admin/payments/' + id, { method: 'POST', body: { action: act, note } }); toast(act === 'validate' ? 'Abonnement activé ✓' : 'Paiement rejeté.', 'ok'); render(); } catch (err) { toast(err.message, 'err'); }
      }, { once: false });
    }
    if (t === 'gateways') {
      const s = await api('admin/payment-gateways');
      N._gwTypes = s.types || [];
      const stBadgeG = (g) => ({
        active: '<span class="badge ok">✓ Active — test de connexion réussi</span>',
        error: `<span class="badge err">✗ ${esc((g.last_error || 'Échec du test').slice(0, 90))}</span>`,
        unconfigured: '<span class="badge warn">Non configurée — testez la connexion</span>',
      }[g.status] || `<span class="badge mut">${esc(g.status)}</span>`);
      body = `<div class="card sec">
        <div class="row"><div style="flex:1"><h3>🏦 Passerelle de paiement automatisée</h3>
        <p class="muted small">Une passerelle n’est <b>active</b> qu’après un <b>test de connexion réel</b> réussi — aucun statut n’est déclaré « connecté » à l’avance. Les secrets restent côté serveur : le navigateur ne reçoit qu’une empreinte masquée. Le flux mobile money manuel (M-Pesa / Orange / Airtel) continue de fonctionner en parallèle, avec validation explicite du Super Admin.</p></div>
        <button class="btn sm" id="addGw">＋ Ajouter une passerelle</button></div>
        <div style="margin-top:14px">
        ${s.gateways.map((g) => `<div class="card" style="margin-bottom:10px">
          <div class="row"><b>${esc(g.name)}</b><span class="chip">${esc(g.type_label)}</span>${g.documented ? '' : '<span class="badge mut">adaptateur générique</span>'}<span class="sp"></span>${stBadgeG(g)}${g.enabled === false ? '<span class="badge mut">désactivée</span>' : ''}</div>
          <div class="muted small" style="margin:8px 0">${g.base_url ? `<span class="mono">${esc(g.base_url)}</span>` : '<span class="badge warn">URL de base absente</span>'} · devise ${esc(g.currency || '—')} · multiplicateur ${esc(g.price_multiplier)} · ${g.has_secret ? `clé ${esc(g.secret_hint)}` : '<span class="badge warn">clé secrète absente</span>'} · webhook ${g.has_webhook_secret ? esc(g.webhook_secret_hint) : '<span class="badge warn">secret webhook absent</span>'}</div>
          <div class="muted small" style="margin:4px 0">URL de notification à copier dans le tableau de bord du gateway :<br><span class="mono">${esc(location.origin + '/api/v1/payments/webhook/' + g.id)}</span></div>
          <div class="row wrap"><button class="btn sm ghost" data-gtest="${g.id}">🔍 Tester la connexion</button><button class="btn sm ghost" data-gtog="${g.id}">${g.enabled === false ? 'Activer' : 'Désactiver'}</button><button class="btn sm ghost" data-gedit="${g.id}">Éditer</button><button class="btn sm danger" data-gdel="${g.id}">Supprimer</button></div>
        </div>`).join('') || '<div class="empty">Aucune passerelle configurée. Ajoutez <b>Flutterwave</b> (contrat officiel v3) ou un <b>adaptateur générique</b> dont vous décrivez le contrat (URL, secret, chemins, schéma de signature).</div>'}
        </div>
      </div>
      <div id="gwForm" style="display:none"><div class="card sec">
        <h3 id="gwFormTitle">Ajouter une passerelle</h3>
        <p class="muted small" style="margin-bottom:12px">🔑 <b>La clé secrète marchande est le seul champ obligatoire.</b> Les secrets sont stockés côté serveur et ne sont jamais renvoyés au navigateur : laissez le champ vide pour conserver la clé existante. Toute modification remet le statut à « non configurée » — relancez le test de connexion.</p>
        <div class="grid g2">
          <div class="field"><label>Type de passerelle</label><select class="inp" id="gwType">${N._gwTypes.map((x) => `<option value="${x.type}">${esc(x.label)}</option>`).join('')}</select></div>
          <div class="field"><label>Nom</label><input class="inp" id="gwName" placeholder="ex. : Flutterwave production"></div>
          <div class="field"><label>URL de base</label><input class="inp mono" id="gwBase" placeholder="https://api.flutterwave.com/v3"></div>
          <div class="field"><label>Clé secrète marchande * (jamais renvoyée au navigateur)</label><input class="inp mono" id="gwSecret" type="password" autocomplete="off" placeholder="FLWSECK_TEST-…"></div>
          <div class="field"><label>Secret de signature du webhook (Flutterwave : le secret défini dans son tableau de bord — vide = clé secrète)</label><input class="inp mono" id="gwHookSecret" type="password" autocomplete="off"></div>
          <div class="field"><label>Devise facturée</label><input class="inp mono" id="gwCurrency" placeholder="USD"></div>
          <div class="field"><label>Multiplicateur de conversion (1 = montant du plan)</label><input class="inp" type="number" id="gwMult" value="1" min="0.000001" step="any"></div>
        </div>
        <div id="gwAdv" style="display:none">
          <h4 class="small" style="margin:20px 0 6px">Contrat du gateway (adaptateur générique)</h4>
          <p class="muted small" style="margin-bottom:12px">Aucun endpoint n’est supposé : décrivez les chemins et les schémas de réponse de votre gateway. Sans ces informations, l’adaptateur refuse de démarrer et la passerelle reste inactive.</p>
          <div class="grid g2">
            <div class="field"><label>Chemin de création de paiement *</label><input class="inp mono" id="gwCreate" placeholder="/payments"></div>
            <div class="field"><label>Chemin de vérification ({id} = identifiant)</label><input class="inp mono" id="gwVerify" placeholder="/payments/{id}"></div>
            <div class="field"><label>Chemin de test de connexion *</label><input class="inp mono" id="gwTest" placeholder="/health"></div>
            <div class="field"><label>Schéma d’authentification</label><select class="inp" id="gwAuthScheme"><option value="bearer">Bearer (Authorization: Bearer …)</option><option value="header">En-tête brut</option><option value="body">Corps de la requête</option></select></div>
            <div class="field"><label>En-tête d’authentification</label><input class="inp mono" id="gwAuthHeader" value="Authorization"></div>
            <div class="field"><label>Préfixe de l’en-tête d’authentification</label><input class="inp mono" id="gwAuthPrefix" value="Bearer "></div>
            <div class="field"><label>Signature du webhook</label><select class="inp" id="gwHookScheme"><option value="hmac_sha256">HMAC-SHA256 du corps reçu</option><option value="plain">Secret renvoyé par le gateway</option></select></div>
            <div class="field"><label>En-tête de signature</label><input class="inp mono" id="gwHookHeader" value="x-signature"></div>
            <div class="field"><label>Encodage de la signature</label><select class="inp" id="gwHookEnc"><option value="hex">hexadécimal</option><option value="base64">base64</option></select></div>
            <div class="field"><label>Chemin du lien de paiement (réponse)</label><input class="inp mono" id="gwLinkPath" value="link"></div>
            <div class="field"><label>Chemin de l’identifiant de transaction</label><input class="inp mono" id="gwIdPath" value="id"></div>
            <div class="field"><label>Chemin de la référence</label><input class="inp mono" id="gwRefPath" value="reference"></div>
            <div class="field"><label>Chemin du montant</label><input class="inp mono" id="gwAmountPath" value="amount"></div>
            <div class="field"><label>Chemin de la devise</label><input class="inp mono" id="gwCurrencyPath" value="currency"></div>
            <div class="field"><label>Chemin du statut</label><input class="inp mono" id="gwStatusPath" value="status"></div>
            <div class="field"><label>Statuts de succès (séparés par des virgules)</label><input class="inp mono" id="gwSuccess" value="successful,success,paid,completed"></div>
          </div>
        </div>
        <div class="row" style="margin-top:16px"><button class="btn" id="gwSave">Enregistrer</button><button class="btn ghost" id="gwCancel">Annuler</button></div>
      </div></div>`;
    }
    if (t === 'projects') {
      const s = await api('admin/projects');
      body = `<div class="row wrap sec">${['', 'published', 'in_moderation', 'suspended', 'draft'].map((st) => `<a class="chip" style="cursor:pointer" href="#/admin?tab=projects&st=${st}">${st || 'Tous'} (${st ? s.projects.filter((p) => p.status === st).length : s.projects.length})</a>`).join('')}</div>
      ${(() => { const fl = (location.hash.match(/st=(\w+)/) || [])[1]; const rows = fl ? s.projects.filter((p) => p.status === fl) : s.projects; return `<table class="tbl"><thead><tr><th>Projet</th><th>Type</th><th>Propriétaire</th><th>Statut</th><th>Actions</th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td><a href="#/projects/${p.id}">${esc(p.name)}</a></td><td>${esc(p.type)}</td><td class="muted small">${esc(p.owner_email)}</td><td>${statusBadge(p.status)}</td>
      <td><div class="row wrap" style="gap:6px">
        ${p.status === 'in_moderation' ? '<button class="btn sm" data-pract="' + p.id + ':approve">✅ Approuver</button>' : ''}
        ${p.status !== 'suspended' ? '<button class="btn sm ghost" data-pract="' + p.id + ':suspend">Suspendre</button>' : '<button class="btn sm ghost" data-pract="' + p.id + ':restore">Restaurer</button>'}
        <button class="btn sm danger" data-pract="' + p.id + ':delete">Supprimer</button>
      </div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun projet.</td></tr>'}</tbody></table>`; })()}`;
      document.body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-pract]');
        if (!b) return;
        const [id, act] = b.dataset.pract.split(':');
        if (act === 'delete' && !await confirmModal('Supprimer ce projet publié ?', 'Action définitive.')) return;
        try { await api('admin/projects/' + id, { method: 'POST', body: { action: act, confirmed: true } }); toast('Fait.', 'ok'); render(); } catch (err) { toast(err.message, 'err'); }
      }, { once: false });
    }
    if (t === 'plans') {
      const s = await api('admin/plans');
      body = `<p class="muted small sec">Les quotas s’appliquent côté serveur à chaque création. Modifiables à tout moment.</p>
      <table class="tbl"><thead><tr><th>Plan</th><th>Prix $/mois</th><th>Créations/jour</th><th>Apps/jour</th><th>Priority</th></tr></thead><tbody>
      ${s.plans.map((p) => `<tr><td><b>${esc(p.name)}</b></td>
      <td><input class="inp" style="width:90px" type="number" min="0" id="pl_${p.id}_price" value="${p.price}"></td>
      <td><input class="inp" style="width:110px" type="number" min="1" id="pl_${p.id}_c" value="${p.creations_per_day}"></td>
      <td><input class="inp" style="width:90px" type="number" min="1" id="pl_${p.id}_a" value="${p.apps_per_day}"></td>
      <td>${p.priority}</td>
      <td><button class="btn sm ghost" data-plan="${p.id}">Enregistrer</button></td></tr>`).join('')}</tbody></table>`;
      document.body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-plan]');
        if (!b) return;
        try {
          await api('admin/plans/' + b.dataset.plan, { method: 'POST', body: { price: $('#pl_' + b.dataset.plan + '_price').value, creations_per_day: $('#pl_' + b.dataset.plan + '_c').value, apps_per_day: $('#pl_' + b.dataset.plan + '_a').value } });
          toast('Plan mis à jour.', 'ok'); render();
        } catch (err) { toast(err.message, 'err'); }
      }, { once: false });
    }
    if (t === 'settings') {
      const s = await api('admin/settings');
      const v = s.settings;
      body = `<div class="grid g2">
      <div class="card sec"><h3>Fonctionnalités</h3>
        <label class="row" style="margin:10px 0"><input type="checkbox" id="sMod" ${v.moderation ? 'checked' : ''} style="width:auto"> Modération des publications</label>
        <label class="row" style="margin:10px 0"><input type="checkbox" id="sReg" ${v.register_open !== false ? 'checked' : ''} style="width:auto"> Inscriptions ouvertes</label>
        <label class="row" style="margin:10px 0"><input type="checkbox" id="sCmd" ${v.automation_allow_commands !== false ? 'checked' : ''} style="width:auto"> Autoriser les commandes shell (avec confirmation)</label>
        <label class="row" style="margin:10px 0"><input type="checkbox" id="sMaint" ${v.maintenance ? 'checked' : ''} style="width:auto"> Mode maintenance</label>
        <div class="field" style="margin-top:12px"><label>Commission plateforme (décimal, ex. 0.10 = 10 %)</label><input class="inp" type="number" step="0.01" min="0" max="0.9" id="sComm" value="${v.commission_rate ?? 0.1}"></div>
      </div>
      <div class="card sec"><h3>Moyens de paiement mobiles</h3>
        ${['mpesa', 'orange', 'airtel'].map((m) => `<div class="field"><label>${{ mpesa: 'M-Pesa', orange: 'Orange Money', airtel: 'Airtel Money' }[m]} — numéro de réception</label>
        <input class="inp" id="pay_${m}_n" value="${esc((v.payment || {})[m] ? (v.payment[m].number || '') : '')}" placeholder="+243 …"><label style="margin-top:8px;display:block">Instructions affichées à l’utilisateur</label>
        <input class="inp" id="pay_${m}_i" value="${esc((v.payment || {})[m] ? (v.payment[m].instructions || '') : '')}"></div>`).join('')}
      </div>
      </div>
      <button class="btn" id="sSave">💾 Enregistrer les paramètres</button>
      <div class="card sec" style="margin-top:20px;border-color:rgba(139,92,246,.45)"><h3>👑 Transmission du pouvoir (Super Admin)</h3>
        <p class="muted small" style="margin-bottom:12px">Cédez votre grade de Super Admin à un autre compte existant. Votre mot de passe sera demandé en confirmation. Vous pourrez ensuite rester <b>sous-administrateur</b> (sans permissions) ou devenir <b>utilisateur standard</b>.</p>
        <div class="grid g2">
          <div class="field"><label>Email du compte qui reçoit le grade *</label><input class="inp" id="trEmail" type="email" placeholder="nouveau.proprietaire@exemple.com"></div>
          <div class="field"><label>Mon rôle après le transfert</label><select class="inp" id="trOld"><option value="sub_admin">Sous-administrateur (sans permissions)</option><option value="user">Utilisateur standard</option></select></div>
        </div>
        <div class="field"><label>Votre mot de passe (confirmation) *</label><input class="inp" type="password" id="trPw" autocomplete="current-password"></div>
        <button class="btn" id="trGo">👑 Transférer le grade</button>
      </div>
      <div class="card sec" style="margin-top:20px"><h3>Permissions disponibles (sous-admins)</h3>
        <div class="pill-row">${s.permissions.map((p) => `<span class="chip">${esc(PERM_LBL[p] || p)}</span>`).join('')}</div>
        <p class="hint">Attribuées par utilisateur via l’onglet Utilisateurs. Un sous-admin ne peut jamais s’accorder lui-même des privilèges supplémentaires.</p></div>`;
      if ($('#trGo')) $('#trGo').onclick = async () => {
        const email = $('#trEmail').value.trim();
        if (!email) return toast('Renseignez l’email du compte cible.', 'err');
        if (!await confirmModal('Transférer le grade Super Admin ?', 'Le compte ' + email + ' deviendra Super Admin. Vous perdrez immédiatement ce grade. Cette action est irréversible et journalisée.', true)) return;
        try {
          const d = await api('admin/transfer-ownership', { method: 'POST', body: { target_email: email, old_role: $('#trOld').value, password: $('#trPw').value, confirmed: true } });
          toast(d.message, 'ok');
          N.user = null;
          render();
        } catch (e) { toast(e.message, 'err'); }
      };
      $('#sSave').onclick = async () => {
        try {
          await api('admin/settings', { method: 'POST', body: {
            moderation: $('#sMod').checked, register_open: $('#sReg').checked, automation_allow_commands: $('#sCmd').checked, maintenance: $('#sMaint').checked,
            commission_rate: parseFloat($('#sComm').value),
            payment: { mpesa: { number: $('#pay_mpesa_n').value, instructions: $('#pay_mpesa_i').value }, orange: { number: $('#pay_orange_n').value, instructions: $('#pay_orange_i').value }, airtel: { number: $('#pay_airtel_n').value, instructions: $('#pay_airtel_i').value } },
          } });
          toast('Paramètres enregistrés.', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
    }
    if (t === 'logs') {
      const s = await api('admin/logs?limit=200');
      body = `<table class="tbl"><thead><tr><th>Quand</th><th>Akteur</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>
      ${s.logs.map((l) => `<tr><td class="muted small">${fmt(l.at)}</td><td class="mono small">${esc(l.actor)}</td><td><span class="chip">${esc(l.action)}</span></td><td class="small">${esc(l.target || '')}</td><td class="mono small muted">${esc(JSON.stringify(l.meta || {}).slice(0, 120))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Journal vide.</td></tr>'}</tbody></table>`;
    }
    return shell('Administration', `
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === t ? 'on' : ''}" data-atab="${k}">${l}</button>`).join('')}</div>
      <div id="atabody">${body}</div>`);
  }

  function bindAdmin() {
    document.querySelectorAll('[data-atab]').forEach((b) => (b.onclick = () => { location.hash = '#/admin?tab=' + b.dataset.atab; }));
    bindGateways();
  }

  // ---------- Passerelle de paiement (Super Admin) ----------
  function applyGwType(reset) {
    const type = $('#gwType') ? $('#gwType').value : 'flutterwave';
    const meta = (N._gwTypes || []).find((x) => x.type === type) || {};
    if ($('#gwAdv')) $('#gwAdv').style.display = type === 'candy' ? 'block' : 'none';
    if (!$('#gwBase')) return;
    if (reset || !$('#gwBase').value) $('#gwBase').value = meta.default_base || '';
    if (reset || !$('#gwCurrency').value) $('#gwCurrency').value = meta.default_currency || 'USD';
    if (!reset) return;
    $('#gwCreate').value = meta.create_path || '';
    $('#gwTest').value = meta.test_path || '';
    $('#gwHookScheme').value = meta.webhook_scheme || 'hmac_sha256';
    $('#gwHookHeader').value = meta.webhook_header || 'x-signature';
  }

  function bindGateways() {
    if ($('#gwType')) $('#gwType').onchange = () => applyGwType(false);
    if ($('#addGw')) $('#addGw').onclick = () => {
      N._editGw = null;
      $('#gwForm').style.display = 'block';
      $('#gwFormTitle').textContent = 'Ajouter une passerelle';
      $('#gwName').value = ''; $('#gwSecret').value = ''; $('#gwHookSecret').value = '';
      $('#gwCurrency').value = ''; $('#gwMult').value = 1;
      applyGwType(true);
      $('#gwForm').scrollIntoView({ behavior: 'smooth' });
    };
    if ($('#gwCancel')) $('#gwCancel').onclick = () => { $('#gwForm').style.display = 'none'; };
    if ($('#gwSave')) $('#gwSave').onclick = async () => {
      const type = $('#gwType').value;
      const cfg = {};
      if (type === 'candy') {
        cfg.create_path = $('#gwCreate').value.trim();
        cfg.verify_path = $('#gwVerify').value.trim();
        cfg.test_path = $('#gwTest').value.trim();
        cfg.auth_scheme = $('#gwAuthScheme').value;
        cfg.auth_header = $('#gwAuthHeader').value.trim();
        cfg.auth_prefix = $('#gwAuthPrefix').value;
        cfg.webhook_scheme = $('#gwHookScheme').value;
        cfg.webhook_header = $('#gwHookHeader').value.trim();
        cfg.webhook_encoding = $('#gwHookEnc').value;
        cfg.checkout_url_path = $('#gwLinkPath').value.trim();
        cfg.payment_id_path = $('#gwIdPath').value.trim();
        cfg.ref_path = $('#gwRefPath').value.trim();
        cfg.amount_path = $('#gwAmountPath').value.trim();
        cfg.currency_path = $('#gwCurrencyPath').value.trim();
        cfg.status_path = $('#gwStatusPath').value.trim();
        cfg.success_values = $('#gwSuccess').value.split(',').map((x) => x.trim()).filter(Boolean);
      }
      const body = {
        name: $('#gwName').value.trim(), type,
        base_url: $('#gwBase').value.trim(),
        secret: $('#gwSecret').value,
        webhook_secret: $('#gwHookSecret').value,
        currency: $('#gwCurrency').value.trim().toUpperCase(),
        price_multiplier: parseFloat($('#gwMult').value),
        config: cfg,
      };
      try {
        if (N._editGw) await api('admin/payment-gateways/' + N._editGw, { method: 'POST', body: { action: 'update', ...body } });
        else await api('admin/payment-gateways', { method: 'POST', body });
        toast('Passerelle enregistrée. Lancez un test de connexion : elle ne devient active qu’après un test réussi.', 'ok');
        render();
      } catch (e) { toast(e.message, 'err'); }
    };
    if (N._gwBound) return;
    N._gwBound = true;
    document.body.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-gtest]');
      if (t) {
        t.innerHTML = '<span class="spin"></span> Test en cours…';
        try {
          const d = await api('admin/payment-gateways/' + t.dataset.gtest, { method: 'POST', body: { action: 'test' } });
          toast(d.ok ? 'Connexion réussie — passerelle active ✓' : 'Test échoué : ' + (d.error || ''), d.ok ? 'ok' : 'err');
          render();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      const tg = e.target.closest('[data-gtog]');
      if (tg) { try { await api('admin/payment-gateways/' + tg.dataset.gtog, { method: 'POST', body: { action: 'toggle' } }); render(); } catch (err) { toast(err.message, 'err'); } return; }
      const ed = e.target.closest('[data-gedit]');
      if (ed) {
        const d = await api('admin/payment-gateways');
        const g = (d.gateways || []).find((x) => x.id === parseInt(ed.dataset.gedit));
        if (!g) return;
        N._editGw = g.id;
        const c = g.config || {};
        $('#gwForm').style.display = 'block';
        $('#gwFormTitle').textContent = 'Éditer : ' + g.name;
        $('#gwType').value = g.type;
        $('#gwName').value = g.name || '';
        $('#gwBase').value = g.base_url || '';
        $('#gwSecret').value = '';
        $('#gwHookSecret').value = '';
        $('#gwCurrency').value = g.currency || '';
        $('#gwMult').value = g.price_multiplier === undefined ? 1 : g.price_multiplier;
        $('#gwCreate').value = c.create_path || '';
        $('#gwVerify').value = c.verify_path || '';
        $('#gwTest').value = c.test_path || '';
        $('#gwAuthScheme').value = c.auth_scheme || 'bearer';
        $('#gwAuthHeader').value = c.auth_header || 'Authorization';
        $('#gwAuthPrefix').value = c.auth_prefix != null ? c.auth_prefix : 'Bearer ';
        $('#gwHookScheme').value = c.webhook_scheme || 'hmac_sha256';
        $('#gwHookHeader').value = c.webhook_header || 'x-signature';
        $('#gwHookEnc').value = c.webhook_encoding || 'hex';
        $('#gwLinkPath').value = c.checkout_url_path || 'link';
        $('#gwIdPath').value = c.payment_id_path || 'id';
        $('#gwRefPath').value = c.ref_path || 'reference';
        $('#gwAmountPath').value = c.amount_path || 'amount';
        $('#gwCurrencyPath').value = c.currency_path || 'currency';
        $('#gwStatusPath').value = c.status_path || 'status';
        $('#gwSuccess').value = (c.success_values || ['successful', 'success', 'paid', 'completed']).join(', ');
        applyGwType(false);
        $('#gwForm').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const dl = e.target.closest('[data-gdel]');
      if (dl) {
        if (!await confirmModal('Supprimer cette passerelle ?', 'La clé secrète et la configuration seront effacées du serveur.')) return;
        try { await api('admin/payment-gateways/' + dl.dataset.gdel, { method: 'POST', body: { action: 'delete', confirmed: true } }); toast('Passerelle supprimée.', 'ok'); render(); } catch (err) { toast(err.message, 'err'); }
      }
    });
  }

  // ---------- Paramètres ----------
  async function viewSettings() {
    const d = await api('providers');
    return shell('Paramètres', `
      <div class="grid g2">
        <div class="card sec"><h3>Compte</h3>
          <div class="kv" style="margin-bottom:16px"><div class="k">Email</div><div>${esc(N.user.email)}</div><div class="k">Rôle</div><div>${esc(N.user.role)}</div><div class="k">Inscrit le</div><div>${fmt(N.user.created_at)}</div></div>
          <h4 class="small" style="margin-bottom:10px">Changer le mot de passe</h4>
          <div class="field"><label>Mot de passe actuel</label><input class="inp" type="password" id="pwCur" autocomplete="current-password"></div>
          <div class="field"><label>Nouveau mot de passe</label><input class="inp" type="password" id="pwNext" autocomplete="new-password"></div>
          <button class="btn sm" id="pwGo">Mettre à jour</button>
        </div>
        <div class="card sec"><h3>Modèle IA préféré</h3>
          <div class="field"><label>Fournisseur</label><select class="inp" id="dProv"><option value="">Moteur local NovaCore</option>${d.providers.filter((p) => p.enabled).map((p) => `<option value="${p.id}" ${d.default.provider_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Modèle</label><input class="inp mono" id="dModel" value="${esc(d.default.model || '')}"></div>
          <button class="btn sm" id="dSave">Enregistrer</button>
          <p class="hint">Sans fournisseur connecté, le moteur local assure le fonctionnement de base (créations, gestion, automatisations) sans clé API.</p>
        </div>
      </div>`);
  }

  function bindSettings() {
    if ($('#pwGo')) $('#pwGo').onclick = async () => {
      try { await api('auth/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNext').value } }); toast('Mot de passe mis à jour.', 'ok'); $('#pwCur').value = ''; $('#pwNext').value = ''; }
      catch (e) { toast(e.message, 'err'); }
    };
    if ($('#dSave')) $('#dSave').onclick = async () => {
      try { await api('settings/model', { method: 'POST', body: { provider_id: $('#dProv').value || null, model: $('#dModel').value || null } }); toast('Enregistré.', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------- Routeur ----------
  const VIEWS = {
    '#/dashboard': async () => viewDashboard(),
    '#/assistant': async () => viewAssistant(),
    '#/studio': async () => viewStudio(),
    '#/projects': async () => viewProjects(),
    '#/files': async () => viewFiles(),
    '#/automation': async () => viewAutomation(),
    '#/billing': async () => viewBilling(),
    '#/providers': async () => viewProviders(),
    '#/mcp': async () => viewMcp(),
    '#/admin': async () => viewAdmin(),
    '#/settings': async () => viewSettings(),
  };

  async function render() {
    const root = $('#root');
    const hash = location.hash || '#/';
    const base = hash.split('?')[0].split('/')[1];
    try {
      // Statut / bootstrap
      if (!N.status) {
        try { N.status = await api('status'); } catch { N.status = { initialized: true }; }
      }
      if (!N.status.initialized) {
        root.innerHTML = viewSetup();
        bindAuth();
        return;
      }
      if (base === 'login' || base === 'register') {
        root.innerHTML = base === 'login' ? viewLogin() : viewRegister();
        bindAuth();
        return;
      }
      if (!N.user) {
        try {
          const me = await api('auth/me');
          N.user = me.user;
        } catch {
          location.hash = '#/login';
          return;
        }
      }
      // Détail projet
      let m;
      if ((m = hash.match(/^#\/projects\/(\d+)/))) {
        const d = await api('projects/' + m[1]);
        N._pfiles = d.files;
        root.innerHTML = await viewProject(m[1]);
        bindShell();
        bindProject(d.project);
        renderProjectTab(d.project, d.files, (hash.match(/tab=(\w+)/) || [])[1] || 'preview');
        return;
      }
      if (base === 'studio' && !hash.startsWith('#/studio/')) hash = '#/studio/app';
      const key = hash.startsWith('#/studio/') ? '#/studio' : '#' + '/' + base;
      const fn = VIEWS[key];
      if (!fn) { location.hash = '#/dashboard'; return; }
      root.innerHTML = await fn();
      bindShell();
      if (key === '#/assistant') bindAssistant();
      if (key === '#/files') bindFiles();
      if (key === '#/studio') bindStudio();
      if (key === '#/automation') bindAutomation();
      if (key === '#/billing') bindBilling();
      if (key === '#/providers') bindProviders();
      if (key === '#/mcp') bindMcp();
      if (key === '#/admin') bindAdmin();
      if (key === '#/settings') bindSettings();
    } catch (e) {
      if (e.message && e.message.includes('Non authentifié')) { N.user = null; location.hash = '#/login'; return; }
      root.innerHTML = `<div class="auth-wrap"><div class="auth-card">${brand()}<div class="card"><h3>Erreur</h3><p class="muted">${esc(e.message)}</p><p class="hint"><a class="link" href="#/dashboard">Retour au tableau de bord</a></p></div></div></div>`;
    }
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();

  return { api, toast, esc, render };
})();
