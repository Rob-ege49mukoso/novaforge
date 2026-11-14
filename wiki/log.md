---
title: Journal
stage: develop
updated_at: 2026-11-14T10:05Z
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
