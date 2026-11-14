---
title: Journal
stage: develop
updated_at: 2026-11-14T12:10Z
---

# Journal

- **2026-11-14T09:25Z** — Plan de développement v1.4 approuvé par l'utilisateur.
  Plan reconstruit depuis la feuille de route documentée du dépôt
  (« Limites honnêtes » du README, « Limites à connaître » de SECURITY_NOTES)
  car la carte de plan n'était pas récupérable depuis le bac à sable. Quatre
  livrables : boucle d'outils + streaming, passerelle de paiement
  automatisée, durcissement SSRF par épinglage d'IP, tests élargis +
  documentation v1.4.
- **2026-11-14T10:05Z** — v1.4 étape 1 livrée : boucle d'outils complète dans
  `server/lib/llm.js` (garde-fous anti-boucle, trace des outils), moteur local
  NovaCore extrait dans `server/lib/novacore.js` (il produit des appels
  d'outils normalisés et emprunte la même boucle), streaming SSE incrémental
  sur `/api/v1/assistant/chat` et `/api/v1/projects/:id/chat` (mode JSON
  historique conservé), rendu progressif + indicateur de saisie + bouton
  d'arrêt dans l'interface. `node --test` : 22 tests verts (2 nouveaux
  fichiers de test). Voir [Boucle d'outils et streaming](project/entity-boucle-outils-streaming.md).
- **2026-11-14T11:25Z** — v1.4 étape 2 livrée : passerelle de paiement automatisée
  (`server/lib/payments.js`), sur le patron du module fournisseurs IA —
  configuration Super Admin, test de connexion réel, statut actif seulement
  après succès, clés jamais renvoyées en clair. Flux mobile money manuel et
  commission 10 % conservés ; aucune transaction simulée. Adaptateur
  Flutterwave sur contrat officiel documenté + adaptateur générique « Candy »
  entièrement décrit par le Super Admin (aucun endpoint inventé). Webhook
  signé et idempotent, contrôle du montant et de la devise, activation
  automatique de l'offre. Routes admin, onglet « Passerelle » et tunnel de
  paiement côté utilisateur. Tests : `test/payments.test.js`.
  Voir [Passerelle de paiement](project/entity-passerelle-paiement.md).
- **2026-11-14T11:05Z** — Étape 2 de la v1.4 dispatchée au Fullstack Builder :
  passerelle de paiement automatisée (`server/lib/payments.js`), sur le patron
  du module fournisseurs IA — configuration Super Admin, test de connexion
  réel, statut actif seulement après succès, clés jamais renvoyées en clair.
  Flux mobile money manuel et commission 10 % conservés ; aucune transaction
  simulée.
- **2026-11-14T11:40Z** — v1.4 étape 3 livrée : durcissement SSRF par épinglage d'IP.
  Nouveau client `requestOutbound()` dans `server/lib/network.js` : une seule
  résolution DNS par requête, validation de TOUTES les adresses obtenues, puis
  connexion à l'adresse validée via un `lookup` personnalisé (`node:http` /
  `node:https`, zéro dépendance npm). Le nom d'hôte est conservé pour l'en-tête
  `Host`, le SNI et la vérification du certificat — qui n'est ni désactivée ni
  contournée. Les redirections sont suivies (3 sauts) mais chacune est
  re-résolue et re-validée. IPv6 et IPv4 mappées (`::ffff:`, NAT64) contrôlées
  via les règles IPv4. Tous les appels sortants passent par ce client :
  fournisseurs IA (dont le streaming SSE), MCP, automatisations, passerelle de
  paiement, outil `web_fetch` des agents. Limites SSRF obsolètes retirées de
  SECURITY_NOTES. `node --test` : 48 tests verts (10 nouveaux dans
  `test/network.test.js`). Voir [Épinglage d'IP](project/entity-epinglage-ip.md).
- **2026-11-14T12:10Z** — v1.4 étape 4 dispatchée au Fullstack Builder : suite de
  tests automatisés élargie (aujourd'hui seuls sécurité, ressources, boucle
  d'outils, streaming, passerelle et réseau sont couverts — il manque auth,
  quotas, facturation, moteur de génération et automatisation) + documentation
  v1.4 (README.md : ligne obsolète annonçant la passerelle pour une version
  future à corriger, section v1.4.0 à ajouter, version à mettre à jour ;
  SECURITY_NOTES.md : section v1.4.0 déjà présente, ne conserver que les limites
  qui subsistent). Contraintes transmises : ne pas réécrire les étapes 1 à 3,
  tests existants verts, zéro dépendance npm, Node 20, tout en français.
- **2026-11-14T12:10Z** — v1.4 étape 4 livrée : suite de tests élargie et
  documentation v1.4. Quatre nouveaux fichiers de test — `test/auth.test.js`
  (inscription, connexion, sessions, rôles, permissions, compte bloqué),
  `test/quotas-billing.test.js` (quotas journaliers creations/applications,
  demande de paiement mobile money, validation, activation d'offre,
  comptabilité 10 %, idempotence), `test/generator.test.js` (compréhension,
  fichiers produits, tests obligatoires réellement exécutés, versionnage) et
  `test/automation.test.js` (consignes, exécution réelle, protection SSRF,
  planification, historique). Les fichiers des étapes 1 à 3 sont inchangés :
  **79 tests verts**, zéro dépendance npm, tout en français. `README.md` :
  version 1.4.0, ligne sur les paiements automatisés corrigée (livrés, plus
  « prévus »), limite retirée, section « Version 1.4.0 » ajoutée (streaming
  SSE, passerelle de paiement, épinglage d'IP) et tableau de la suite de
  tests. `SECURITY_NOTES.md` : titre en 1.4.0, limites résolues retirées,
  limites subsistantes conservées. Voir [Suite de tests et documentation
  v1.4](project/entity-suite-tests-v14.md).
