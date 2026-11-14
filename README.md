# ⚡ NovaForge — Plateforme IA universelle de nouvelle génération

Plateforme web **réellement fonctionnelle** (Node.js, 0 dépendance npm) qui permet à n’importe quel utilisateur de transformer une idée exprimée en langage naturel en **application, API ou agent IA réellement fonctionnel**, puis de le tester, le modifier, le versionner et le publier.

> **Version 1.4.0** — Node.js 20+, **zéro dépendance npm**, suite de tests automatisés (`node --test`).

## Démarrage

```bash
node server/app.js          # → http://localhost:8080
```

## 🏭 Types de projets générés

| Type | Détection (description) | Ce qui est produit |
|---|---|---|
| **🌐 Application web** | par défaut | Fichier HTML autonome (UI + logique + persistance navigateur), 11 domaines métier, responsive |
| **🧱 Full stack** | « full stack », « base de données », « backend », « multi-utilisateurs »… | Front HTML **synchronisé avec son API** (CRUD + `GET/POST /api/state`), persistance **serveur**, PWA installable, export autonome `node server.js` (front + API + `data.json`) |
| **📱 App mobile** | « mobile », « android », « ios », « apk » | Full stack + **projet Capacitor complet** (`capacitor.config.json`, `package.json`, `make-www.js`), PWA, README avec les commandes exactes de compilation **APK/iOS** (la compilation se fait sur votre machine, Android Studio/Xcode requis) |
| **🔌 API** | « api », « rest », « endpoint » | API REST CRUD exécutée par le runtime de la plateforme + export autonome + OpenAPI 3.0 |
| **🤖 Agent IA** | « agent », « chatbot » | Agent avec persona, outils (calcul, date/heure, web, MCP) |

## ⚙️ Deux moteurs de génération

1. **Moteur LOCAL (hors ligne, par défaut)** — règles + gabarits testés. Fonctionne **sans internet ni IA** : la plateforme génère, teste et livre même en mode avion.
2. **Moteur IA (en ligne)** — dès qu'un fournisseur IA est configuré **et a réussi son test réel** (Administration → Fournisseurs), le code est écrit par l'IA puis soumis aux **mêmes tests obligatoires**. En cas d'échec (fournisseur, format, tests) : 1 itération de correction, puis **repli automatique sur le moteur local**. Le moteur utilisé est tracé sur chaque version (`engine: "ai" | "local"`) et visible dans l'UI.

> Règle d'honnêteté : aucun statut « IA » sans test réel réussi ; un code qui échoue les tests n'est jamais présenté comme fonctionnel.

## ☁️ Stockage Supabase (actif)

Les données de la plateforme (comptes, sessions, **clés API des fournisseurs**, secrets MCP, projets, abonnements, journaux) sont stockées dans le **projet Supabase dédié « NovaForge »** (ref `lxqihdfozdifwubrjqfa`, eu-west-1) — le projet « Elema » n'est pas utilisé.

- Table unique `public.nfx_data (key, table_name, data jsonb, updated_at)` — créée par migration.
- Configuration : `supabase.config.json` à la racine (`url` + `key` service_role) **ou** variables d'environnement `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`. Ce fichier est **exclu du dépôt git** (jamais de secrets dans le code public).
- La clé service_role ne quitte jamais le serveur : l'API n'expose que des versions masquées des clés.
- Sans configuration Supabase, la plateforme retombe automatiquement sur le store local (`data/db.json`) — aucune fonctionnalité n'est perdue.
- Indicateur de backend : `GET /api/v1/status → backend: "supabase"` et carte « Stockage des données » dans Administration → Paramètres.

### Première initialisation (sécurisée)
Au premier lancement, la plateforme affiche l’écran **Setup** : le compte **propriétaire / Super Admin** est créé là, avec un mot de passe fort **choisi par l’utilisateur** (jamais codé en dur). L’email `robegemukoso49@gmail.com` est pré-rempli (modifiable).

- Inscription de comptes utilisateurs : **email uniquement** (page d’inscription + page de connexion).
- Hachage des mots de passe : `scrypt` + sel ; sessions HttpOnly ; rate-limiting des connexions ; autorisations **vérifiées côté serveur** sur chaque route ; isolation des données par utilisateur.

## Ce qui est construit et testé (v1)

| Domaine | État |
|---|---|
| Authentification email + rôles (Super Admin / Sous-admin / Utilisateur) | ✅ |
| Premier setup propriétaire sécurisé (aucun identifiant codé en dur) | ✅ |
| Tableau de bord utilisateur (statistiques, quotas, plan) | ✅ |
| **Création par simple description** — pipeline réel : compréhension → type → fonctionnalités → plan → construction → **tests réels** → aperçu | ✅ |
| Studio (3 espaces : Applications / API / Agents IA) avec description libre | ✅ |
| Applications générées : HTML autonome réellement fonctionnel (CRUD, stats, messagerie, recherche, export) | ✅ |
| API générées : routes CRUD réellement exécutées par le **runtime intégré** (Console API, tests HTTP réels) + export serveur autonome | ✅ |
| Agents IA : chat réel, outils (calculatrice, date, web fetch) + **outils MCP autorisés** ; moteur LLM si fournisseur connecté, sinon moteur local | ✅ |
| Gestion des projets : ouvrir, modifier par description, dupliquer, renommer, suspendre, publier/dépublier, **versionner + restaurer**, supprimer (confirmation) | ✅ |
| Aperçus fonctionnels (iframe) + Export ZIP | ✅ |
| Abonnements (Gratuit / Premium / Premium Plus / Premium Soft) avec **quotas appliqués côté serveur** et tarifs configurables par le Super Admin | ✅ |
| **Paiements mobiles manuels** (M-Pesa, Orange Money, Airtel Money) : référence + preuve, suivi, **activation uniquement après validation explicite du Super Admin** | ✅ |
| Commission 10 % (configurable) : historique, brut / commission / net, aucun double prélèvement, **aucune transaction simulée** | ✅ |
| **Gestionnaire MCP** : ajout manuel (nom, URL, auth, secrets côté serveur), test réel `initialize` + `tools/list`, activation/désactivation, autorisation par outil | ✅ |
| **Orchestration multi-IA** : fournisseurs configurables (OpenAI, OpenRouter, Anthropic, **Ollama local**, compatible OpenAI), test de connexion réel (jamais « connecté » sans succès), choix du modèle par utilisateur, suivi de consommation, **bascule automatique uniquement en cas d’erreur** | ✅ |
| **Boucle d’outils + streaming SSE** : l’assistant et les agents exécutent réellement les outils (calcul, date, web, MCP) et répondent **fragment par fragment**, avec arrêt possible | ✅ |
| **Passerelle de paiement automatisée** : Flutterwave (contrat officiel) ou adaptateur générique configurable, test de connexion réel, webhook signé et idempotent, **activation automatique de l’offre** | ✅ |
| **Épinglage d’IP** sur tous les appels sortants (anti-DNS-rebinding), redirections re-validées, vérification TLS du nom d’hôte conservée | ✅ |
| **Automatisation** : tâches en ligne (HTTP/web) et hors ligne (fichiers, commandes shell) **sur la machine où la plateforme est installée**, planning (« tous les jours à 8h », « dans 30 min »), **confirmation obligatoire pour les commandes**, historique complet, info système | ✅ |
| Super Admin : statistiques, gestion des utilisateurs (bloquer/supprimer/sous-admins + permissions précises), modération des projets, tarifs, paiements, fournisseurs, quotas, journaux d’audit, sauvegarde/restauration | ✅ |
| Journal d’audit de toutes les opérations sensibles | ✅ |
| Architecture **modulaire et évolutive** (voir ci-dessous) | ✅ |

### Architecture évolutive
- `server/lib/*` : chaque domaine est un module isolé (db, auth, llm, mcp, automation) — brancher SQLite/PostgreSQL = remplacer `lib/db.js` ; ajouter un fournisseur IA = 1 bloc dans `lib/llm.js`.
- `server/generator/*` : moteur de création et gabarits — ajouter un nouveau « domaine métier » = une entrée dans `templates.js`.
- Routes déclaratives dans `server/app.js` (table `routes`) — ajouter une fonctionnalité = ajouter des routes.
- Les **paiements automatisés** sont branchés sur le même flux de validation : passerelle configurable côté Super Admin (Flutterwave ou adaptateur générique), test de connexion réel, webhook signé et idempotent, activation automatique de l’offre.
- **Auto-amélioration contrôlée** : toute évolution passe par version (restauration possible), tests, et l’approbation du Super Admin (paramètres/tarifs/modération). L’IA ne modifie jamais elle-même règles de sécurité ou rôles.

## Configuration des clés IA (étapes)
1. Ouvrir **⚡ Orchestration IA** (Super Admin).
2. « Ajouter un fournisseur » → type (ex. OpenAI, OpenRouter, **Ollama local** sans clé), URL de base, clé, modèles.
3. Seule la **clé API est obligatoire** : nom, URL et modèles sont facultatifs (défauts intelligents selon le type).
4. « 🔍 Tester la connexion » — le statut ne passe à *Connecté* qu’après succès réel.
4. Chaque utilisateur choisit son modèle par défaut (Paramètres). Sans fournisseur, le **moteur local NovaCore** maintient toutes les fonctions de base sans clé API.

## Tests effectués lors de la mise en place
Setup, inscription/connexion, blocage de compte, quotas, génération app/api/agent + tests réels, runtime API (CRUD HTTP), versions/restauration, publication + modération, paiement → validation → activation, commission, MCP (serveur de démo `scripts/mcp-mock.js` : `node scripts/mcp-mock.js`), automatisation (HTTP + commande avec confirmation), journal d’audit, sauvegarde.

### Suite de tests automatisés (`node --test`)

79 tests, sans aucune dépendance npm, tous en français :

| Fichier | Couverture |
|---|---|
| `test/security.test.js` | politique réseau, commandes shell désactivées, traversée de chemin, runtime d’API |
| `test/resources.test.js` | sélection, extraction et conversion des fichiers importés |
| `test/llm-tools.test.js` | boucle d’outils, garde-fous anti-boucle, moteur local NovaCore, trames SSE |
| `test/chat-stream.test.js` | points d’entrée de chat : mode JSON historique et streaming SSE |
| `test/payments.test.js` | passerelle : signatures, test de connexion réel, idempotence, activation, comptabilité |
| `test/network.test.js` | épinglage d’IP, rebinding, redirections re-validées, IPv6 et IPv4 mappées, TLS |
| `test/auth.test.js` | inscription, connexion, sessions, rôles, permissions, compte bloqué |
| `test/quotas-billing.test.js` | quotas journaliers (créations et applications), facturation, activation d’offre |
| `test/generator.test.js` | moteur de génération : compréhension, fichiers produits, tests obligatoires, versionnage |
| `test/automation.test.js` | automatisation : consignes, exécution réelle, protection SSRF, planification, historique |

## Limites honnêtes (v1 → roadmap)
- Les apps générées sont des **web apps autonomes** (données locales). L’export Android APK nécessitera une chaîne de build (roadmap) ; les apps sont déjà responsive/PWA.
- L’automatisation pilote **la machine hôte** de NovaForge ; un « compagnon » pour d’autres appareils est en roadmap.
- Les commandes shell restent **désactivées** tant qu’aucun exécuteur isolé (conteneur/VM) n’est mis en place.
- Le moteur local couvre les fonctions essentielles (assistant, agents, outils, streaming) ; les **réponses conversationnelles les plus riches** s’obtiennent avec un fournisseur IA connecté.

## Sauvegarde / restauration
`POST /api/v1/admin/backup` (bouton dans Administration) crée un snapshot de la base dans `data/backups/`. Les projets vivent dans `data/projects/<id>/v<N>/`.


## Importation de fichiers (v1.2.0)

L’espace **Mes fichiers** accepte plusieurs fichiers de tous types : ZIP, images, vidéos, audio, PDF, documents et fichiers binaires. Les fichiers sont privés à leur propriétaire et peuvent être téléchargés ou supprimés depuis l’interface.

- Limite par fichier : 100 Mo par défaut (`UPLOAD_MAX_BYTES`).
- Quota par utilisateur : 500 Mo par défaut (`UPLOAD_USER_QUOTA_BYTES`).
- Les limites peuvent être ajustées par variables d’environnement.
- Les ZIP sont conservés tels quels : ils ne sont pas extraits automatiquement.
- Les fichiers importés ne sont jamais exécutés par le serveur.
- Sur Render, configurez un disque persistant et définissez `NOVAFORGE_UPLOAD_DIR` vers son point de montage (par exemple `/var/data/novaforge-uploads`) pour conserver les fichiers après redémarrage/redéploiement. Sans disque persistant, le stockage local peut être éphémère.

## Ressources et transformations (v1.3.0)

- La bibliothèque « Mes fichiers » accepte les fichiers importés comme données privées et permet de les lier à un projet depuis le Studio.
- Le mode manuel laisse l’utilisateur choisir les fichiers ; le mode automatique analyse les noms et le texte lisible de ses derniers fichiers puis demande une confirmation avant génération.
- Les contenus texte pris en charge (TXT, Markdown, CSV, JSON, HTML, CSS, JavaScript, XML) peuvent alimenter le contexte de génération, avec une limite cumulée de 24 Ko par projet.
- Les images, vidéos, fichiers audio, PDF, ZIP et autres binaires restent conservés et liés comme ressources ; ils ne sont pas exécutés. Leur analyse multimodale ou l’extraction automatique des archives n’est pas activée dans cette version.
- « Compresser (.gz) » crée une copie GZIP ; « Convertir en MD » convertit les documents texte compatibles. Les originaux ne sont jamais écrasés.
- Les transformations consomment le quota de stockage personnel.

## Version 1.4.0

Trois livrables fonctionnels, tous vérifiés par la suite de tests automatisés décrite plus haut.

### 🔁 Boucle d’outils et streaming (assistant & agents)

L’assistant et les agents exécutent réellement les outils : la boucle complète `appel du modèle → exécution de l’outil → renvoi du résultat dans la conversation → réponse finale`. Le moteur local NovaCore produit des appels d’outils au même format normalisé, donc les agents fonctionnent **sans fournisseur IA**. Garde-fous en place : nombre maximum d’itérations, nombre maximum d’appels, détection des cycles (même outil, mêmes arguments), trace `tools_used` exposée dans la réponse.

Les deux points d’entrée de chat (`/api/v1/assistant/chat` et `/api/v1/projects/:id/chat`) acceptent `stream: true` et renvoient alors un **flux SSE** : fragments progressifs, indicateur de saisie, bouton d’arrêt. Le mode JSON historique est conservé (aucune régression pour les clients existants).

### 💳 Passerelle de paiement automatisée

Sur le patron des fournisseurs IA : configuration côté Super Admin, **test de connexion réel**, statut « actif » **seulement après succès**, clés jamais renvoyées en clair (seule une empreinte masquée est exposée).

- **Flutterwave** : contrat API officiel documenté (`POST /payments`, `GET /transactions/{id}/verify`, en-tête de webhook `verif-hash`).
- **Adaptateur générique** (« Candy ») : entièrement décrit par le Super Admin (URL de base, secret, chemins, schéma de signature, schémas de réponse). **Aucun endpoint n’est supposé** : tant que le contrat n’est pas renseigné, l’adaptateur refuse de fonctionner.

Initialisation du paiement → notification signée sur le corps brut (HMAC-SHA256 ou en-tête `verif-hash`, comparaison à temps constant) → **activation automatique de l’offre** (30 jours). Traitement **idempotent** : notification rejouée sans double effet, montant ou devise divergents refusés, transaction en échec sans activation. Le flux mobile money manuel (M-Pesa, Orange Money, Airtel Money) et la commission 10 % (brut / commission / net) restent **intacts** ; aucune transaction n’est simulée.

### 🔒 Épinglage d’IP (anti-DNS-rebinding)

Tous les appels sortants passent par un client unique : **une seule résolution DNS** par requête, validation de **toutes** les adresses obtenues, puis connexion à l’adresse validée via un `lookup` personnalisé (`node:http` / `node:https`, zéro dépendance npm). Le nom d’hôte est conservé pour l’en-tête `Host`, le SNI et la **vérification du certificat** — qui n’est ni désactivée ni contournée. Les redirections sont suivies mais **re-résolues et re-validées** à chaque saut ; les adresses IPv6 et IPv4 mappées (`::ffff:`, NAT64) sont contrôlées avec les règles IPv4.

Concerne les fournisseurs IA (dont le streaming SSE), le serveur MCP, les automatisations, la passerelle de paiement et l’outil `web_fetch` des agents.
