---
title: Journal
stage: develop
updated_at: 2026-11-14T11:25Z
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
