---
title: NovaForge
type: product
stage: develop
status: active
version: 1.3.0
updated_at: 2026-11-14T11:25Z
---

# NovaForge

Plateforme web IA qui transforme une idée en langage naturel en application, API
ou agent IA réellement fonctionnel — puis les teste, les modifie, les versionne
et les publie.

## Positionnement

| Champ | Valeur |
|---|---|
| Catégorie | Plateforme IA universelle / générateur d'applications |
| Langue de l'interface | Français |
| Stack | Node.js 20+, **zéro dépendance npm** (runtime), pas de build front |
| Serveur | `server/app.js` → `http://localhost:8080` (proxié sur `:3000` dans le bac à sable) |
| Front | HTML/CSS/JS statique dans `public/` |
| Stockage | Table unique `public.nfx_data` (Supabase) ou store local `data/db.json` |
| Tests | `node --test` — `test/security.test.js`, `test/resources.test.js` |
| Repo GitHub | `Rob-ege49mukoso/novaforge`, branche `integration-novaforge` |
| Déploiement | Manuel (push GitHub + déclencheur de déploiement) |

## Modules serveur

| Module | Rôle |
|---|---|
| `server/app.js` | Table de routes déclarative, auth, quotas, audit, pipeline de génération |
| `server/lib/db.js` | Store local (fallback) |
| `server/lib/supabase-db.js` | Store Supabase (défaut si configuré) |
| `server/lib/auth.js` | Comptes, rôles, permissions, sessions HttpOnly |
| `server/lib/llm.js` | Orchestration multi-fournisseurs + bascule, comptage d'usage, **boucle d'outils** (`runToolLoop`), **streaming** (`streamChat`) |
| `server/lib/novacore.js` | Moteur local déterministe (assistant + agent) : fonctionne sans fournisseur IA, produit des appels d'outils normalisés |
| `server/lib/mcp.js` | Serveurs MCP, `initialize` + `tools/list`, autorisation par outil |
| `server/lib/automation.js` | Tâches planifiées (HTTP / fichiers), historique |
| `server/lib/network.js` | Politique de sortie réseau (SSRF), lecture bornée |
| `server/lib/resources.js` | Sélection/convertion des fichiers importés (24 Ko de texte max) |
| `server/generator/*` | Moteur de génération, gabarits, tests obligatoires du code produit |

## Principes produit non négociables

1. **Aucun statut « IA » sans test réel réussi** — un fournisseur IA n'est
   « connecté » qu'après un appel réel valide ; en cas d'échec, repli
   automatique sur le moteur local NovaCore.
2. **Aucune transaction simulée** — les paiements sont manuels (M-Pesa, Orange,
   Airtel) avec référence + preuve, activés uniquement après validation
   explicite du Super Admin.
3. **Le code produit doit passer les tests obligatoires** avant d'être
   présenté comme fonctionnel.
4. **L'IA ne modifie jamais elle-même** les règles de sécurité ou les rôles.
5. **Zéro dépendance npm** — c'est une promesse commerciale (fonctionne hors
   ligne, en mode avion).

## v1.4 — plan de développement (approuvé)

Reconstruit depuis la feuille de route explicite du dépôt
(« Limites honnêtes (v1 → roadmap) » du README et « Limites à connaître » de
SECURITY_NOTES).

### 1. Boucle d'outils + streaming pour l'assistant et les agents — **livré le 2026-11-14**

- `server/lib/llm.js` sait déjà détecter `tool_calls` mais ne les exécute
  jamais : il faut la boucle complète `tool_calls → exécution → tool → réponse
  finale`, y compris pour le moteur local NovaCore.
- Les deux points d'entrée (`/api/v1/assistant/chat`,
  `/api/v1/projects/:id/chat`) renvoient un JSON unique : passer en
  streaming incrémental (SSE) avec rendu progressif côté interface.
- Comble la limite documentée « les réponses conversationnelles riches et
  l'usage avancé des outils par les agents s'activent avec un fournisseur IA
  connecté ».

**État :** livré. Détail, protocole SSE et pièges d'implémentation :
[Boucle d'outils et streaming](entity-boucle-outils-streaming.md). Le mode JSON
historique est conservé (le SSE ne s'active que sur demande explicite du
client) ; NovaCore devient un fournisseur d'outils à part entière.

### 2. Passerelle de paiement automatisée (Candy / Flutterwave) — **livré le 2026-11-14**

- Modèle sur le patron déjà éprouvé des fournisseurs IA : configuration
  côté Super Admin, **test de connexion réel**, statut « actif » uniquement
  après succès, clés jamais renvoyées en clair.
- Initialisation du paiement → retour/webhook signé → activation automatique
  de l'offre.
- Le flux manuel mobile money reste intact ; la comptabilité de commission
  (10 %, brut/commission/net) et l'idempotence sont préservées.
- Aucune transaction simulée : sans identifiants merchant, le gateway reste
  inactif et le statut le dit.

**État :** livré. Adaptateur Flutterwave sur contrat officiel documenté,
adaptateur « Candy » générique entièrement décrit par le Super Admin (aucun
endpoint inventé). Webhook signé idempotent, contrôle du montant et de la
devise, onglet « Passerelle » côté Super Admin, tunnel de paiement côté
utilisateur. Détail : [Passerelle de paiement
automatisée](entity-passerelle-paiement.md).

### 3. Durcissement SSRF : épinglage d'IP (anti-DNS-rebinding) — **livré le 2026-11-14**

- `server/lib/network.js` valide la résolution DNS puis `fetch()` résout de
  nouveau : fenêtre TOCTOU exploitable.
- Résoudre une seule fois, tout valider, puis connecter à l'IP validée en
  conservant la vérification TLS du nom d'hôte ; re-valider à chaque
  redirection ; couvrir IPv6 et IPv4 mappées.
- Corrige la limite explicitement documentée dans SECURITY_NOTES.

**État :** livré. Nouveau client `requestOutbound()` : une seule résolution
DNS, validation de **toutes** les adresses, connexion à l'adresse validée via
un `lookup` personnalisé (`node:http`/`node:https`, zéro dépendance), nom
d'hôte conservé pour l'en-tête `Host`, le SNI et la vérification du
certificat, redirections suivies mais re-résolues et re-validées à chaque
saut. IPv6 et IPv4 mappées (`::ffff:`, NAT64) traitées explicitement. Tous
les appels sortants passent par ce client : fournisseurs IA (dont le
streaming SSE), MCP, automatisations, passerelle de paiement, outil
`web_fetch` des agents. Limites résolues retirées de SECURITY_NOTES.
Détail : [Épinglage d'IP](entity-epinglage-ip.md).

### 4. Suite de tests automatisés élargie + documentation v1.4

- Couvrir auth, quotas, facturation, moteur de génération, automatisation,
  streaming et passerelle de paiement (les tests existants ne couvrent que
  sécurité et ressources).
- Mettre à jour `README.md` et `SECURITY_NOTES.md` (version 1.4.0) pour
  refléter ce qui est réellement livré, et retirer les limites résolues tout
  en conservant celles qui subsistent.

## Limites connues qui subsistent après la v1.4

- L'export APK Android nécessite toujours une chaîne de build locale
  (Android Studio / JDK) : la plateforme livre un projet Capacitor complet et
  un guide de compilation, pas un binaire.
- L'automatisation pilote toujours la machine où la plateforme est installée.
- Les commandes shell restent désactivées (exécuteur isolé non implémenté).
