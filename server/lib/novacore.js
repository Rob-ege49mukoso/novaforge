'use strict';
// NovaCore — moteur local déterministe de NovaForge.
//
// Il fonctionne SANS aucun fournisseur IA : aucune clé, aucune connexion internet.
// Deux fonctions :
//  • localAssistant() : assistant conversationnel de la plateforme (actions projet).
//  • agentTurn()      : moteur d'agent, qui produit des appels d'outils au format
//                       normalisé (identique à celui des fournisseurs IA) afin
//                       d'emprunter exactement la même boucle d'outils.
const GEN = require('../generator');

/** Catalogue d'outils standard, disponible même sans fournisseur IA. */
const TOOLS = [
  { type: 'function', function: { name: 'calculator', description: 'Calcule une expression mathématique', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } },
  { type: 'function', function: { name: 'datetime', description: 'Date et heure actuelles', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_fetch', description: 'Récupère le contenu d’une URL', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
];

// ---------- Assistant conversationnel (actions projet) ----------
function localAssistant(user, message) {
  const t = String(message || '').trim();
  const lower = t.toLowerCase();
  const projects = GEN.projects().where((p) => p.owner_id === user.id);
  const actions = [];
  let reply = '';

  const creationRe = /(cr[eé]er?|creer|create|d[eé]velopper|d[eé]veloppe|construis|fais-moi|je veux|j'aimerais|build)/i;
  const typeWord = lower.includes('agent') || /chatbot|assistant ia/i.test(lower) ? 'agent'
    : /\bapi\b|rest/i.test(lower) ? 'api' : /application|app|site|plateforme|outil|syst|dashboard|tableau/i.test(lower) ? 'app' : null;

  if (creationRe.test(lower) || (typeWord && /(cr[ée]er|creer|create|developpe|développe|fais)/i.test(lower))) {
    const type = typeWord || 'app';
    const vague = t.replace(creationRe.source, '').replace(typeWord || '', '').trim().length < 4;
    if (vague) {
      reply = 'Avec plaisir ! Pour construire votre projet, précisez un peu le sujet. Par exemple :\n\n• « Crée-moi une application de livraison »\n• « Je veux une API pour gérer ma boutique »\n• « Crée un agent IA pour mon service client »\n\nOu choisissez un type :';
      actions.push({ type: 'suggest', options: ['app', 'api', 'agent'] });
    } else {
      reply = `Je vais construire votre **${type === 'api' ? 'API' : type === 'agent' ? 'agent IA' : 'application'}** à partir de votre description.\n\n**Plan :**\n1. Compréhension de la demande\n2. Identification des fonctionnalités\n3. Construction réelle du projet\n4. Tests automatiques\n5. Aperçu fonctionnel\n\nConfirmez la création :`;
      actions.push({ type: 'create', kind: type, description: t, label: `🚀 Créer (projet ${type})` });
    }
  } else if (/liste|vois|montre/.test(lower) && /projet/.test(lower)) {
    if (projects.length === 0) reply = 'Vous n’avez encore aucun projet. Décrivez-moi ce que vous voulez créer (application, API ou agent IA) et je le construis.';
    else {
      reply = 'Vos projets :\n\n' + projects.slice(0, 8).map((p) => `• **${p.name}** (${p.type}) — ${p.status}`).join('\n');
      actions.push({ type: 'goto', to: '#/projects', label: '📁 Ouvrir la page Projets' });
    }
  } else if (/(publie|publier|dépublie|depublier)/i.test(lower) && /projet/.test(lower)) {
    const p = projects.find((x) => x.name.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(lower.replace(/[^a-z0-9]+/g, '')) || (lower.includes(x.name.toLowerCase().slice(0, 8)) && x.name.toLowerCase().slice(0, 8).length > 3));
    if (!p) reply = 'Je ne trouve pas ce projet par son nom. Dites-moi lequel (ex. : « publie Livraison »).';
    else {
      const doPublish = !/dépublie|depublier/i.test(lower);
      reply = `Je vais ${doPublish ? 'publier' : 'dépublier'} **${p.name}**.`;
      actions.push({ type: 'project_action', project_id: p.id, action: doPublish ? 'publish' : 'unpublish', label: doPublish ? '✅ Publier ' + p.name : '↩ Dépublier ' + p.name });
    }
  } else if (/(supprime|supprimer)/i.test(lower) && /projet/.test(lower)) {
    const p = projects.find((x) => x.name.toLowerCase().includes(lower.replace(/[^a-z0-9]+/g, '').slice(0, 10)) && lower.replace(/[^a-z0-9]+/g, '').length > 4);
    if (!p) reply = 'Je ne trouve pas ce projet par son nom. Indiquez le nom exact (ex. : « supprime Mon API »).';
    else {
      reply = `⚠️ Supprimer **${p.name}** est définitif. Confirmez :`;
      actions.push({ type: 'project_action', project_id: p.id, action: 'delete', label: '🗑 Confirmer la suppression' });
    }
  } else if (/automatis|automate|planifi|tous les jours|demain à|dans \d+ min/i.test(lower)) {
    reply = 'Je peux créer cette automatisation sur la machine où NovaForge est installée (tâche en ligne ou hors ligne). Elle sera exécutée après votre confirmation si elle lance une commande.';
    actions.push({ type: 'create_automation', description: t, label: '🤖 Créer l’automatisation' });
  } else if (/aide|help|que peux-tu|capacit|comment fonctionnes/i.test(lower)) {
    reply = 'Je suis **Nova**, l’assistant de NovaForge. Ce que je peux faire :\n\n• 🏗 **Créer** des applications, des API et des agents IA par simple description\n• 📁 Gérer vos projets (lister, publier, supprimer, modifier)\n• 🤖 Créer des **automatisations** sur l’appareil hôte (requêtes, fichiers, commandes, planning)\n• 💬 Discuter et vous accompagner\n\nEssayez : « Crée-moi une application de gestion financière ».';
  } else {
    reply = 'Je peux construire des projets pour vous (applications, API, agents IA), les gérer, et créer des automatisations. Décrivez votre besoin en langage naturel — par exemple « Crée-moi une application de livraison » — ou tapez « aide ».';
  }
  return { reply, actions };
}

// ---------- Moteur d'agent local (appels d'outils normalisés) ----------
let toolSeq = 0;
const nextToolId = (prefix) => `${prefix}_nc_${Date.now().toString(36)}_${(toolSeq += 1)}`;

/** Construit un appel d'outil normalisé (même forme que celui d'un fournisseur IA). */
function toolCall(name, args) {
  return { id: nextToolId(name), type: 'function', function: { name, arguments: JSON.stringify(args || {}) } };
}

/**
 * Un tour de conversation NovaCore.
 * Renvoie { content, tool_calls } — tool_calls au format OpenAI normalisé.
 */
function agentTurn(messages, opts = {}) {
  const persona = opts.persona || '';
  const name = opts.name || 'Nova';
  const userMsg = [...messages].reverse().find((m) => m.role === 'user');
  const text = String((userMsg && userMsg.content) || '');
  const lower = text.toLowerCase();

  // Un résultat d'outil est déjà disponible : on compose la réponse finale.
  const results = messages.filter((m) => m.role === 'tool');
  if (results.length) {
    return { content: composeFromTool(results[results.length - 1]), tool_calls: [] };
  }

  const calls = [];
  if (/(calcul|calcule|combien|résultat|resultat|somme|produit|multiplie)/.test(lower)) {
    const expr = text.match(/[-+*/().\d\s,^%]+/);
    if (expr && /[\d]/.test(expr[0])) calls.push(toolCall('calculator', { expression: expr[0].trim() }));
  }
  if (!calls.length && /(date|heure|jour|aujourdhui|aujourd'hui|maintenant)/.test(lower)) {
    calls.push(toolCall('datetime', {}));
  }
  if (!calls.length) {
    const url = text.match(/https?:\/\/[^\s]+/i);
    if (url) calls.push(toolCall('web_fetch', { url: url[0] }));
  }
  if (calls.length) return { content: '', tool_calls: calls };

  return {
    content: (persona ? persona + '. ' : '') + `Bonjour ! Je suis **${name}**. Décrivez votre demande et je m’en occupe. (Configurez un fournisseur IA dans « Orchestration IA » pour des réponses entièrement naturelles et l’usage d’outils avancés.)`,
    tool_calls: [],
  };
}

/** Transforme le résultat brut d'un outil en réponse en français. */
function composeFromTool(toolMsg) {
  let out = null;
  try { out = JSON.parse(toolMsg.content); } catch { out = null; }
  if (out === null || typeof out !== 'object') return 'Résultat : ' + String(toolMsg.content || '').slice(0, 400);
  if (out.error) return '⚠️ L’outil n’a pas pu aboutir : ' + String(out.error).slice(0, 300);
  if (out.value !== undefined) return 'Résultat : **' + out.value + '**';
  if (out.now) return 'Actuellement : ' + (out.date_fr || '') + ' — ' + (out.heure_fr || out.now);
  if (out.extrait !== undefined) return `Contenu de ${out.url || 'la page'} (HTTP ${out.status || '?'}) : ${String(out.extrait).slice(0, 500)}`;
  if (out.ok !== undefined) return out.ok ? '✅ L’outil s’est exécuté avec succès.' : '⚠️ ' + String(out.error || 'échec').slice(0, 300);
  return 'Résultat : ' + JSON.stringify(out).slice(0, 400);
}

module.exports = { TOOLS, localAssistant, agentTurn, composeFromTool };
