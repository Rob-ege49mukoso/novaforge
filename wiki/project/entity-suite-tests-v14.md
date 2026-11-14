---
title: Suite de tests automatisés et documentation v1.4
type: entity
stage: develop
status: active
version: 1.4.0
updated_at: 2026-11-14T12:10Z
---

# Suite de tests automatisés et documentation v1.4

v1.4 — étape 4 (dernière). Les étapes 1 à 3 ne sont pas réécrites : leurs
tests restent verts, le travail porte sur la **couverture** et la
**documentation**.

## Couverture ajoutée

| Fichier | Domaine couvert | Type de test |
|---|---|---|
| `test/auth.test.js` | inscription, connexion, sessions, rôles, permissions, compte bloqué, changement de mot de passe | module + HTTP |
| `test/quotas-billing.test.js` | quotas journaliers (créations et applications), demande de paiement mobile money, validation, activation d'offre, comptabilité 10 %, idempotence | HTTP |
| `test/generator.test.js` | compréhension de la demande, fichiers produits par type, **tests obligatoires réellement exécutés**, versionnage, re-test | module |
| `test/automation.test.js` | consignes en langage naturel, exécution réelle HTTP/fichiers, protection SSRF, planification quotidienne, isolation par utilisateur, historique | module + réseau |

Les fichiers des étapes 1 à 3 (`security`, `resources`, `llm-tools`,
`chat-stream`, `payments`, `network`) sont **inchangés** : 79 tests verts au
total, zéro dépendance npm, tout en français.

## Points de méthode

- Les tests HTTP démarrent le serveur réel (`require('../server/app.js')`) sur
  un port libre, avec **repli** si le port est déjà pris (les fichiers de test
  peuvent être exécutés en parallèle).
- Les tests du moteur de génération vérifient le principe produit : un projet
  n'est versionné « ok » que si **tous** les tests obligatoires ont réussi
  (`versions[0].ok === true`, `engine === 'local'` sans fournisseur IA).
- Le test d'automatisation vers une adresse de métadonnées cloud
  (`169.254.169.254`) vérifie au passage la protection SSRF de l'étape 3.

## Documentation mise à jour

- `README.md` : version 1.4.0 affichée, ligne sur les paiements automatisés
  corrigée (livrés, plus « prévus » ), limite correspondante retirée, tableau
  des domaines complété (streaming SSE, passerelle, épinglage), nouvelle
  section « Version 1.4.0 » (boucle d'outils + streaming, passerelle de
  paiement, épinglage d'IP) et tableau de la suite de tests.
- `SECURITY_NOTES.md` : titre passé en 1.4.0, **limites résolues retirées**
  (pinning DNS), limites subsistantes conservées, section v1.4.0 déjà en place
  (étapes 2 et 3).
