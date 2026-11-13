# 🚀 Publier NovaForge sur GitHub

Le dépôt git est **déjà initialisé avec son commit** (historique inclus dans ce zip).
Deux possibilités :

## Option A — avec GitHub CLI (recommandé)
```bash
unzip novaforge-repo.zip && cd novaforge
gh repo create novaforge --private --source=. --push
```

## Option B — en manuel
```bash
unzip novaforge-repo.zip && cd novaforge
# 1) Créez un dépôt vide "novaforge" sur github.com (sans README)
git remote add origin https://github.com/VOTRE_UTILISATEUR/novaforge.git
git push -u origin main
```

## Notes
- Le dossier `data/` (données d'exécution : clés API, sessions, projets des utilisateurs)
  est **volontairement exclu** du dépôt — sécurité : on ne publie jamais de secrets.
  Le dépôt contient 100 % du code, de la config et de la documentation.
- Pour relancer ailleurs : `node server/app.js` (Node 18+, aucune dépendance npm).
