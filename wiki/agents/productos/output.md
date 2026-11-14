---
title: ProductOS — journal d'orchestration
stage: develop
updated_at: 2026-11-14T12:10Z
---

# ProductOS — journal d'orchestration

## 2026-11-14T09:25Z — Début de l'exécution du plan v1.4

- Contexte lu : projet importé `novaforge`, wiki vierge au démarrage, mémoire
  projet vide. Produit existant et abouti (v1.3.0), pas de travail amont dans
  le wiki.
- Plan de développement approuvé par l'utilisateur ; carte de plan non
  récupérable depuis le bac à sable → plan reconstruit depuis la feuille de
  route du dépôt, consigné dans `wiki/project/novaforge.md`.
- Portée retenue : (1) boucle d'outils + streaming assistant/agents,
  (2) passerelle de paiement automatisée, (3) épinglage d'IP anti-DNS-rebinding,
  (4) tests élargis + documentation v1.4.
- Prochaine action : dispatch du Fullstack Builder, étape par étape.

## 2026-11-14T09:26Z — Étape 1 dispatchée

- Délégation au Fullstack Builder : boucle d'outils `tool_calls → exécution →
  résultat → réponse finale` dans `server/lib/llm.js`, streaming SSE sur
  `/api/v1/assistant/chat` et `/api/v1/projects/:id/chat` (mode JSON conservé
  en repli), rendu progressif dans `public/js/app.js` + `public/index.html`.
- Contraintes transmises : zéro dépendance npm, Node 20, tout en français,
  NovaCore local préservé, `node --test` vert.
- Résultat : **QUEUED** — le build démarre automatiquement à la fin de ce tour.
- En attente : les étapes 2, 3 et 4 seront dispatchées une par une, chacune
  après validation de la précédente. Points de contrôle : le moteur local ne
  doit jamais casser, aucune transaction simulée ne doit apparaître.

## 2026-11-14T11:05Z — Étape 1 validée, étape 2 dispatchée

- Étape 1 (boucle d'outils + streaming) confirmée livrée : `runToolLoop` dans
  `server/lib/llm.js`, moteur local NovaCore extrait dans `server/lib/novacore.js`,
  streaming SSE sur les deux endpoints de chat (mode JSON conservé), UI avec
  indicateur de saisie et bouton d'arrêt. 22 tests `node --test` verts.
- État du code relu avant dispatch : routes de facturation `server/app.js`
  (~L509-551), validation admin des paiements (~L1168-1191), réglages
  commission + méthodes manuelles (~L1258-1284), calcul brut/commission/net
  (~L1293-1305), patron fournisseurs IA de référence (`server/lib/llm.js` :
  `testProvider` + `listProviders`, sortie HTTP bornée par
  `server/lib/network.js`), table générique `db.table(...)` sans schéma.
- Étape 2 dispatchée au Fullstack Builder : `server/lib/payments.js`
  (adaptateurs gateway, test de connexion réel, init paiement, webhook HMAC,
  idempotence, activation auto de l'offre), routes admin + table
  `payment_gateways`, secrets jamais en clair, flux mobile money et commission
  10 % préservés, `node --test` vert.
- Point d'honnêteté transmis : Candy traité en adaptateur générique
  configurable (base_url / secret / signature) — aucun endpoint non vérifié ne
  doit être inventé ; le gateway reste inactif sans identifiants merchant.
- Résultat : **QUEUED** — démarrage automatique en fin de tour.
- En attente : étapes 3 (épinglage d'IP anti-DNS-rebinding) et 4 (tests
  élargis + documentation v1.4) à dispatcher une par une.

## 2026-11-14T11:25Z — Étape 2 validée, étape 3 dispatchée

- Étape 2 (passerelle de paiement automatisée) confirmée livrée et relue dans
  le code : `server/lib/payments.js` — adaptateur Flutterwave sur contrat
  officiel documenté, adaptateur générique « Candy » sans aucun endpoint
  inventé, test de connexion réel, secrets jamais renvoyés en clair
  (empreinte masquée), webhook signé idempotent avec contrôle du montant et
  de la devise, activation automatique 30 jours, commission 10 % et flux
  mobile money manuel préservés. Routes admin `/api/v1/admin/payment-gateways`,
  tunnel `/api/v1/billing/gateway/checkout`, onglet « Passerelle » côté Super
  Admin, `test/payments.test.js`.
- Notes consignées : fiche produit (v1.4 point 2 marqué livré), page
  « Passerelle de paiement automatisée », index, vue d'ensemble, journal.
- État du code relu avant dispatch : `server/lib/network.js` résout le DNS
  puis chaque appelant refait `fetch(url)` — la résolution rejouée laisse une
  fenêtre TOCTOU exploitable (DNS rebinding). Appels sortants à migrer :
  `automation.js`, `llm.js`, `mcp.js`, `payments.js`, `app.js`.
- Étape 3 dispatchée au Fullstack Builder : épinglage d'IP — résolution unique,
  validation de toutes les adresses, connexion à l'adresse validée en
  conservant la vérification TLS du nom d'hôte, re-validation à chaque
  redirection, IPv6 et IPv4 mappées, zéro dépendance npm (`node:http` /
  `node:https` + `lookup` personnalisé).
- Contraintes transmises : ne pas réécrire l'étape 2, `readLimited` doit
  rester compatible, `node --test` vert, tests rebinding / redirection / IPv6,
  `SECURITY_NOTES.md` à jour.
- Résultat : **QUEUED** — démarrage automatique en fin de tour.
- En attente : étape 4 (tests élargis + documentation v1.4).

## 2026-11-14T12:10Z — Étape 3 validée, étape 4 dispatchée

- État des lieux demandé par l'utilisateur (« qu'est-ce qui reste ? ») :
  l'état réel du dépôt et du wiki confirme que les étapes 1, 2 et 3 sont
  livrées et documentées ; il ne reste que l'étape 4 du plan v1.4.
- Étape 3 (épinglage d'IP) confirmée livrée et relue dans le code :
  `requestOutbound()` dans `server/lib/network.js`, résolution unique,
  validation de toutes les adresses, `lookup` personnalisé sur
  `node:http`/`node:https`, nom d'hôte conservé pour l'en-tête `Host`, le SNI
  et la vérification du certificat, redirections re-résolues et re-validées,
  IPv6 et IPv4 mappées traitées. `test/network.test.js` ajouté (10 tests) ;
  48 tests verts au total selon le journal de l'étape 3.
- Couverture de test relevée avant dispatch (6 fichiers) : `security`,
  `resources`, `llm-tools`, `chat-stream`, `payments`, `network`. Manquants :
  auth (comptes, sessions, rôles, blocage), quotas, facturation
  (abonnement, activation d'offre), moteur de génération, automatisation.
- Documentation : `SECURITY_NOTES.md` porte déjà sa section v1.4.0 (étapes 2
  et 3) ; `README.md` annonce encore la passerelle pour une version future et
  n'a pas de section v1.4.0 — c'est l'écart à corriger.
- Étape 4 dispatchée au Fullstack Builder : nouveaux fichiers de test pour les
  cinq domaines non couverts, mise à jour de `README.md` (ligne obsolète
  retirée, section v1.4.0 ajoutée, version à jour), `SECURITY_NOTES.md`
  réduit aux limites qui subsistent. Contraintes : ne pas réécrire les étapes
  1 à 3, tests existants verts, zéro dépendance npm, Node 20, français.
- Résultat : **QUEUED** — démarrage automatique en fin de tour.
- En attente : validation de l'étape 4, puis décision de déploiement (le
  déploiement reste manuel : push GitHub + déclencheur).
