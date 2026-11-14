# Notes de sécurité — NovaForge 1.1.0

Cette révision corrige plusieurs risques identifiés lors de l'audit du ZIP d'origine.

## Changements réalisés

- Désactivation complète des commandes shell arbitraires dans l'application ; l'option d'administration ne peut plus les réactiver.
- Planification quotidienne basée sur `next_run`, réservation d'une tâche avant son exécution et conservation de la récurrence après un échec.
- Validation des chemins du workspace, y compris les chemins qui traverseraient un lien symbolique.
- Contrôle des URL sortantes utilisées par MCP, les automatisations et les outils web : protocoles HTTP(S), refus des adresses privées/réservées, absence de redirection automatique et limite de taille des réponses.
- Le runtime d'API ne charge plus le fichier `api.js` modifiable du projet comme code serveur ; il reconstruit les routes à partir des métadonnées du projet et des gabarits internes.
- Cookies `HttpOnly`, `SameSite=Lax` et `Secure` en HTTPS/production ; contrôle d'origine et de `Sec-Fetch-Site` pour les mutations API et les routes `/run/`.
- Contexte de requête isolé avec `AsyncLocalStorage` pour éviter de mélanger les adresses IP dans les journaux d'audit.
- Répertoire de données configurable via `NOVAFORGE_DATA_DIR` pour utiliser un volume persistant en hébergement.

## Limites à connaître

- Le contrôle DNS des URL sortantes est une défense contre les destinations privées, mais ne constitue pas un mécanisme de pinning DNS au niveau socket ; une protection complète contre le DNS rebinding nécessitera un client réseau qui épingle l'adresse IP résolue tout en conservant la validation TLS du nom d'hôte.
- Le runtime d'API est volontairement limité aux API produites par les gabarits internes. Les modifications manuelles de `api.js` ne sont pas exécutées.
- Les commandes shell nécessiteraient un exécuteur isolé distinct (conteneur/VM avec quotas et permissions minimales) avant de pouvoir être réactivées.
- Les tests fournis sont des tests unitaires et des tests de démarrage ciblés. Ils ne remplacent pas un audit d'intrusion externe ni une recette complète de toutes les fonctions métier.


## Version 1.2.0 — importation de fichiers

- Ajout d'un espace de fichiers privé, avec contrôle de propriété pour la liste, le téléchargement et la suppression.
- Upload multipart limité à 100 Mo par fichier et quota par utilisateur de 500 Mo par défaut.
- Tous les types sont acceptés et stockés comme données opaques ; les fichiers ne sont pas exécutés.
- Les ZIP ne sont pas décompressés automatiquement (protection contre Zip Slip et les archives bombes).
- Téléchargement forcé en pièce jointe par défaut ; aperçu inline limité à quelques formats image/vidéo/audio connus et avec `X-Content-Type-Options: nosniff`.
- Le stockage binaire reste sur le système de fichiers. Un disque persistant Render est nécessaire pour garantir la conservation des fichiers après redéploiement.
- Limite résiduelle : le contrôle DNS avant une requête sortante ne constitue pas un pinning DNS complet ; une protection anti-DNS-rebinding supplémentaire est recommandée avant exposition à des utilisateurs non fiables.

## Version 1.3.0 — ressources de projet

- La sélection manuelle et la proposition automatique sont filtrées par propriétaire ; une proposition automatique exige une confirmation avant génération.
- Le moteur ne reçoit que du texte explicitement pris en charge, borné à 24 Ko au total et marqué comme contenu non fiable. Les fichiers binaires ne sont jamais exécutés.
- Les copies GZIP et les conversions texte passent par le quota utilisateur et ne remplacent jamais l’original.
- Les images, médias, PDF et archives restent attachés comme références ; l’analyse visuelle/audio/vidéo et l’extraction ZIP ne sont pas prises en charge par cette version.

## Version 1.4.0 — passerelle de paiement automatisée

- Les clés marchandes (clé secrète, secret de signature du webhook) ne quittent jamais le serveur : elles sont stockées côté serveur et l’interface ne reçoit qu’une empreinte masquée. Aucun secret n’est renvoyé en clair par l’API.
- Une passerelle n’est déclarée « active » qu’après un **test de connexion réel** réussi. Sans identifiants marchands, ou sans chemin de test décrit pour l’adaptateur générique, elle reste « non configurée » et le statut le dit. Aucune transaction n’est simulée.
- Les notifications de paiement sont authentifiées par signature sur le **corps brut** de la requête : HMAC-SHA256 (hexadécimal ou base64) pour l’adaptateur générique, comparaison à temps constant de l’en-tête `verif-hash` documenté par Flutterwave. Aucune notification n’est acceptée sans signature, ni avec une signature calculée sur un corps différent.
- Traitement idempotent : une notification rejouée n’active pas un second abonnement ; un montant ou une devise divergents de ce qui a été facturé n’activent rien ; une transaction en échec n’active rien.
- L’activation automatique ne porte que sur l’offre achetée (30 jours), comme la validation manuelle du Super Admin. Le flux mobile money manuel (M-Pesa, Orange Money, Airtel Money) reste intact et reste validé manuellement.
- Le webhook est public par nature : il est authentifié par signature, pas par session, et le contrôle d’origine du navigateur ne s’y applique pas.
