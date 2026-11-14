---
title: Épinglage d'IP (anti-DNS-rebinding)
type: entity
stage: develop
status: active
version: 1.4.0
updated_at: 2026-11-14T11:40Z
---

# Épinglage d'IP (anti-DNS-rebinding)

v1.4 — étape 3. Correction de la limite SSRF documentée en v1.3 :
`validateOutboundUrl()` résolvait le DNS, puis l'appelant refaisait
`fetch(url)` — qui résout de nouveau. Entre les deux, un attaquant pouvait
faire rebindre le nom (première résolution → IP publique, seconde → IP
privée) : fenêtre TOCTOU exploitable.

## Le nouveau client sortant

`server/lib/network.js` expose désormais `requestOutbound()` : c'est le point
d'entrée unique de tous les appels sortants.

| Étape | Avant | Après |
|---|---|---|
| Résolution DNS | une par `validateOutboundUrl()`, puis **une seconde** par `fetch()` | **une seule** (`resolveOutbound()`) |
| Validation | une adresse suffit | **toutes** les adresses obtenues sont validées |
| Connexion | `fetch()` → nouvelle résolution | `node:http`/`node:https` avec `lookup` personnalisé → l'adresse validée |
| Nom d'hôte | porté par `fetch` | porté explicitement : en-tête `Host`, SNI TLS, vérification du certificat |
| Redirections | `redirect: 'error'` (refusées) | suivies (3 sauts max), chacune **re-résolue et re-validée** |

`lookup` personnalisé = épinglage : le client ne consulte plus le DNS et
renvoie l'adresse déjà validée. Il n'existe plus de fenêtre entre la
validation et la connexion.

## Vérification TLS conservée

Le nom d'hôte est transmis à TLS via `servername`, et `rejectUnauthorized`
reste à `true` :

- connexion épinglée vers `127.0.0.1` pour un hôte `localhost` → le
  certificat est vérifié **au nom `localhost`** → succès ;
- même connexion demandée sous le nom `127.0.0.1` → le certificat ne
  couvre pas l'adresse IP → refus.

La vérification n'est ni désactivée ni contournée.

## IPv6 et IPv4 mappées

- IPv6 : analyse native (`fc`, `fd`, `fe80`, `ff`, `2001:db8:`, `2002:`, …).
- IPv4 mappées `::ffff:0:0/96` et NAT64 `64:ff9b::/96` : l'adresse IPv4
  embarquée est extraite puis contrôlée **avec les règles IPv4** — y compris
  en notation hexadécimale (`::ffff:7f00:1` → `127.0.0.1` → refusée).
  Une IPv4 mappée publique (`::ffff:8.8.8.8`) est acceptée.

## Appels concernés

`server/lib/llm.js` (JSON + streaming SSE), `server/lib/mcp.js`,
`server/lib/automation.js`, `server/lib/payments.js`, `server/app.js`
(outil `web_fetch` des agents). Zéro dépendance npm : pas d'undici.

`readLimited()` accepte désormais les flux web (`fetch`) **et** les flux Node
(`node:http`), et borne la taille dans les deux cas.

## Limite assumée

L'API de stockage Supabase configurée par la plateforme est contactée
directement (URL et clé de service gérées par l'hébergeur) : elle n'est pas
une cible pilotable par un utilisateur de la plateforme.

## Tests

`test/network.test.js` : résolution unique (une seule résolution DNS, en-tête
`Host` conservé), rebinding (la seconde résolution malveillante n'a jamais
lieu), validation de toutes les adresses, redirections re-validées (suivie,
refus vers une IP privée, boucle arrêtée), IPv6 épinglée, IPv4 mappées,
TLS (SNI + certificat vérifié, refus pour une adresse IP), `readLimited`
borné, timeout couvrant la lecture du corps, streaming SSE via le client
épinglé.
