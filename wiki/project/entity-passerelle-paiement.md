---
title: Passerelle de paiement automatisée
type: entity
stage: develop
status: active
version: 1.4.0
updated_at: 2026-11-14T11:25Z
---

# Passerelle de paiement automatisée

v1.4 — étape 2. Module `server/lib/payments.js`, sur le patron déjà éprouvé des
fournisseurs IA (`server/lib/llm.js`) : configuration côté Super Admin, test de
connexion **réel**, statut actif seulement après succès, secrets jamais
renvoyés en clair.

## Deux adaptateurs

| Type | Contrat | Statut |
|---|---|---|
| `flutterwave` | API officielle v3 documentée : `POST /payments`, `GET /transactions/{id}/verify`, en-tête de webhook `verif-hash` | endpoints figés et documentés |
| `candy` | **générique** : URL de base, chemins, schémas de réponse et signature décrits par le Super Admin | aucun endpoint supposé : l'adaptateur refuse de démarrer tant que le contrat n'est pas renseigné |

Aucun endpoint non vérifié n'est inventé. Sans identifiants marchands, la
passerelle reste « non configurée » et le statut affiché le dit.

## Cycle de vie

1. **Configuration** — Super Admin, onglet « Passerelle » : nom, type, URL de
   base, clé secrète, devise, multiplicateur de conversion, contrat.
2. **Test de connexion** — un appel authentifié réel vers la passerelle.
   401/403 → « error » (identifiants refusés) ; 404 sur le chemin de test
  Flutterwave → accepté ; 5xx → « error » ; succès → statut `active`.
   Toute modification de la configuration remet le statut à « unconfigured ».
3. **Paiement** — `POST /api/v1/billing/gateway/checkout` : initialisation
   chez la passerelle, retour de l'URL de paiement. Un seul paiement « en
   cours » par (utilisateur, offre, passerelle) — idempotence.
4. **Webhook** — `POST /api/v1/payments/webhook/:id`, corps brut signé,
   comparaison à temps constant. Réponses :
   - signature absente ou invalide → 401, aucune activation ;
   - référence inconnue → 200 ignoré ;
   - paiement déjà activé → 200 idempotent ;
   - montant ou devise divergents → 200 « mismatch », aucune activation ;
   - transaction en échec → 200 « failed » ;
   - vérification distante en erreur temporaire → 503 (la passerelle réessaie).
5. **Activation** — l'offre est activée 30 jours, comme la validation manuelle
   du Super Admin.

## Comptabilité

Le vocabulaire reste celui de la saisie manuelle : **brut / commission / net**,
taux de 10 % par défaut, piloté par les paramètres de la plateforme. Le
multiplicateur de conversion change le montant facturé dans la devise du
gateway, jamais le brut ni la commission.

## Le flux manuel est intact

M-Pesa, Orange Money et Airtel Money continuent de passer par une demande de
paiement avec référence et preuve, validée manuellement par le Super Admin. La
passerelle automatisée est un **chemin parallèle**, jamais un remplacement.

## Secrets

Jamais de clé complète dans une réponse HTTP : seulement une empreinte
masquée (`has_secret`, `secret_hint`). Les appels sortants passent par
`server/lib/network.js` (protection SSRF, HTTPS obligatoire hors loopback de
développement).

## Tests

`test/payments.test.js` : signature HMAC et en-tête `verif-hash`, refus sans
secret, comptabilité 10 %, non-divulgation des secrets, adaptateur générique
refusant de démarrer sans contrat, test de connexion réel (succès / 401 /
absence d'identifiants sans appel), contrat officiel de création de paiement,
multiplicateur de conversion, idempotence, activation unique, webhook mal
signé, montant divergent, échec de transaction, webhook de référence inconnue.
