---
title: Journal
stage: develop
updated_at: 2026-11-14T11:40Z
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
