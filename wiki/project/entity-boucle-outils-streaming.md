---
title: Boucle d'outils et streaming
type: entity
scope: project
stage: develop
status: active
version: 1.4.0
updated_at: 2026-11-14T10:05Z
---

# Boucle d'outils et streaming (v1.4, étape 1)

Livré le 2026-11-14. Couvre le point 1 du plan v1.4 : les fournisseurs IA
exécutent enfin les outils qu'ils demandent, et les deux points d'entrée de
chat répondent en flux incrémental.

## Boucle d'outils

`server/lib/llm.js` expose `runToolLoop({call, messages, tools, executeTool,
onEvent, maxRounds})` : c'est le cœur du dispositif, indépendant du
fournisseur.

```
appel LLM → tool_calls → exécution des outils → renvoi du résultat dans la
conversation (message « tool ») → nouvel appel LLM → … → réponse finale
```

Garde-fous (constantes exportées) :

| Garde-fou | Valeur | Rôle |
|---|---|---|
| `MAX_TOOL_ROUNDS` | 6 | allers-retours LLM maximum dans la boucle |
| `MAX_TOOL_CALLS` | 24 | exécutions d'outils maximum par requête |
| `MAX_IDENTICAL_CALLS` | 3 | même outil + mêmes arguments → arrêt |

Deux détections de boucle se cumulent : signature de ronde identique (le modèle
redemande exactement les mêmes appels) et compteur par signature d'appel. Dans
les deux cas la boucle s'interrompt et demande une **conclusion** au modèle
sans outils (`noTools: true`) au lieu de rendre la main vide.

La trace de chaque outil (`{tool, args, round, result}`) est renvoyée sous le
nom `tools_used` — c'est elle qui alimente l'UI et l'audit.

## NovaCore, moteur local

`server/lib/novacore.js` regroupe le moteur déterministe qui fonctionne
**sans aucun fournisseur IA** :

- `localAssistant(user, message)` — l'assistant conversationnel (actions
  projet) ;
- `agentTurn(messages, opts)` — le moteur d'agent, qui produit des `tool_calls`
  au **même format normalisé** qu'un fournisseur, donc il emprunte exactement
  la même boucle ;
- `TOOLS` — le catalogue standard (calculator, datetime, web_fetch).

Conséquence : le moteur local n'est plus un chemin parallèle, c'est un
fournisseur comme un autre. Un agent sans IA configuré utilise quand même la
boucle d'outils (outils MCP compris).

## Streaming SSE

`POST /api/v1/assistant/chat` et `POST /api/v1/projects/:id/chat` acceptent
deux modes :

- **JSON classique** (par défaut) — inchangé, aucun client cassé. Le streaming
  ne s'active que si le client le demande : en-tête `Accept: text/event-stream`
  ou paramètre `stream` (corps ou query string) ;
- **SSE** — trames `event: <nom>` + `data: <json>`.

Événements émis :

| Événement | Charge utile | Rôle |
|---|---|---|
| `meta` | `{conversation_id, mode}` | ouverture du flux |
| `round` | `{round}` | nouveau tour de boucle → le client remet la bulle à zéro |
| `delta` | `{text}` | fragment de texte (rendu progressif) |
| `tool` | `{round, tool, args}` | un outil est lancé |
| `tool_result` | `{round, tool, result}` | l'outil a rendu |
| `done` | `{reply, actions?, tools_used, conversation_id?, provider}` | réponse finale (texte faisant autorité) |
| `error` | `{error}` | erreur du flux |

Deux fournisseurs de texte sont supportés en streaming natif : format
OpenAI (`stream: true`) et Anthropic (`content_block_delta`). Les outils
Anthropic sont traduits vers/depuis le format OpenAI par un adaptateur
(`toAnthropicMessages` / `anthropicTools` / `anthropicToolCalls`).

Si un fournisseur a déjà envoyé du texte puis échoue, **on ne bascule pas**
vers un autre fournisseur : le client a déjà reçu des fragments. Le repli sur
NovaCore n'a lieu que si rien n'a encore été envoyé.

## Interface

- `public/js/app.js` — `readSse()`, `createStreamBubble()`, `sendStreamChat()` ;
  indicateur de saisie (trois points animés), bouton « ⏹ Arrêter » (abort du
  fetch), trace des outils en puces, rendu Markdown rafraîchi au plus toutes
  les 60 ms.
- Les agents ont un onglet « Discussion » dans la page projet ; l'aperçu agent
  généré (`agentPreviewHtml`) consomme lui aussi le flux SSE.
- `public/index.html` — région `aria-live` pour annoncer la frappe, l'arrêt et
  la fin de réponse ; `<noscript>` d'explication.

## Pièges rencontrés (à ne pas refaire)

1. **Échappement des littéraux de template** : dans le HTML généré par
   `agentPreviewHtml`, un `\n` écrit tel quel dans le template devient un
   saut de ligne réel et casse la chaîne JS → il faut `\\n` (et `\\\\*` pour
   un `\*` dans une regex).
2. **Nom d'événement SSE** : concaténer au lieu d'affecter donne
   `messagemeta` au lieu de `meta`. Toujours `event = …` et une valeur par
   défaut `''`.
3. **Trace des outils** : `runToolLoop` renvoie `trace`, `chatWithFallback`
   renvoie `tools_used`. Ne pas oublier la conversion sur les chemins qui
   appellent la boucle en direct (moteur local).
4. Le serveur Node n'a pas de rechargement à chaud : il faut le redémarrer
   (`kill <pid du node server/app.js>`) — le superviseur ProductOS le relance
   tout seul.

## Tests

- `test/llm-tools.test.js` — boucle d'outils (exécution, réinjection du
  résultat, boucle infinie, limite d'itérations, erreurs d'outil), NovaCore,
  décodage des trames SSE.
- `test/chat-stream.test.js` — bout en bout : mode JSON conservé, flux SSE
  fragmenté, flux interrompu par le client.

`node --test` : 22 tests, vert.
