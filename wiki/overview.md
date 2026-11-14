---
title: Project overview
stage: develop
updated_at: 2026-11-14T09:25Z
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

## Ce qui est en cours (v1.4)

1. Boucle d'outils + streaming pour l'assistant et les agents IA — **livré**.
2. Passerelle de paiement automatisée (Candy / Flutterwave), sur le modèle du
   patron « fournisseur IA » déjà en place — **livré**.
3. Durcissement SSRF par épinglage d'IP (anti-DNS-rebinding) — en cours.
4. Suite de tests élargie et documentation à jour — à venir.

## Contraintes structurantes

- **Zéro dépendance npm** : c'est une promesse commerciale, pas un détail.
- **Aucune simulation** : ni pour les transactions, ni pour l'état « connecté »
  d'un fournisseur ou d'une passerelle.
- **Le code produit est testé avant d'être annoncé fonctionnel.**
- L'IA ne modifie jamais les règles de sécurité ni les rôles.

## État technique

Bac à sable en cours d'exécution sur `:3000` (le serveur Node `:8080` est
proxifié). Branche `integration-novaforge`, un commit d'historique visible,
code applicatif non commité au dépôt GitHub tant que le déploiement n'est pas
demandé.
