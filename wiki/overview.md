---
title: Project overview
stage: develop
updated_at: 2026-11-14T12:45Z
---

# NovaForge — vue d'ensemble

NovaForge est une plateforme IA universelle qui transforme une description en
langage naturel en application, API ou agent IA réellement fonctionnel, puis
les teste, les modifie, les versionne et les publie. L'interface est en
français.

## Ce qui existe déjà

La v1.3.0 est fonctionnelle et largement couverte : authentification par email
avec rôles, premier setup propriétaire sécurisé, tableau de bord, pipeline de
génération réel (compréhension → type → fonctionnalités → plan → construction →
tests → aperçu), studios Applications / API / Agents, gestion de versions avec
restauration, publication avec modération, abonnements à quotas appliqués côté
serveur, paiements mobiles manuels avec validation Super Admin, commission
10 %, gestionnaire MCP, orchestration multi-IA, automatisation planifiée,
journal d'audit, sauvegarde/restauration, import de fichiers et ressources de
projet.

## v1.4 — livrée le 2026-11-14

Le plan de développement v1.4 est terminé, les quatre étapes étant livrées,
testées et committées :

1. Boucle d'outils + streaming SSE pour l'assistant et les agents IA — **livré**.
2. Passerelle de paiement automatisée (Candy / Flutterwave), sur le modèle du
   patron « fournisseur IA » déjà en place — **livré**.
3. Durcissement SSRF par épinglage d'IP (anti-DNS-rebinding) — **livré**.
4. Suite de tests élargie (79 tests sur 10 fichiers) et documentation v1.4
   (`README.md`, `SECURITY_NOTES.md`) — **livré**.

## Contraintes structurantes

- **Zéro dépendance npm** : c'est une promesse commerciale, pas un détail.
- **Aucune simulation** : ni pour les transactions, ni pour l'état « connecté »
  d'un fournisseur ou d'une passerelle.
- **Le code produit est testé avant d'être annoncé fonctionnel.**
- L'IA ne modifie jamais les règles de sécurité ni les rôles.

## État technique

Bac à sable en cours d'exécution sur `:3000` (le serveur Node `:8080` est
proxifié), prévisualisation :
https://75851498f62b5db98fda0ee8aad67a1b.preview.bl.run. Branche
`integration-novaforge` propre et synchronisée avec
`origin/integration-novaforge` (HEAD `c1a8571` — étape 4 sur 4). Aucun
déploiement public n'existe encore : la publication est **manuelle** (bouton
« Déployer » de la boîte « Publier »), et le projet Vercel est réutilisé à
chaque republication — les commits suivants se mettent en ligne sans nouvelle
installation.
