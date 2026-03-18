# AQERA Backend — Déploiement et production

## 1. Prérequis

- Node.js 20+
- PostgreSQL 14+ (recommandé en production) ou SQLite (dev / petit pilote)
- Variables d’environnement (voir ci‑dessous)

## 2. Secrets et sécurité (production)

- **Ne jamais committer** les fichiers `.env` contenant des secrets.
- **AUTH_SECRET / JWT_SECRET** : en production, générer des valeurs fortes (ex. `openssl rand -base64 32`) et les injecter via la plateforme (Railway, Render, Vercel, etc.).
- **DATABASE_URL** : en production, utiliser une URL PostgreSQL avec un utilisateur dédié et un mot de passe fort.
- **ADMIN_PASSWORD** : modifier après le premier seed en prod.

## 3. Base de données

### Développement (SQLite)

```bash
cd aqera-backend-final-vrai
export DATABASE_URL="file:./prisma/dev.db"
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

### Production (PostgreSQL)

Le fichier `prisma/schema.prod.prisma` est aligné avec `schema.prisma` (mêmes modèles et champs : sécurité, analytics, alertes admin, etc.).

1. Créer une base PostgreSQL (ex. sur Railway, Supabase, ou VM).
2. Exporter l’URL :
   ```bash
   export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
   ```
3. Générer le client Prisma et appliquer le schéma :
   ```bash
   npx prisma generate --schema=prisma/schema.prod.prisma
   npx prisma db push --schema=prisma/schema.prod.prisma
   ```
   Ou, si vous utilisez des migrations PostgreSQL :
   ```bash
   npx prisma migrate deploy --schema=prisma/schema.prod.prisma
   ```
4. (Optionnel) Lancer le seed une fois :
   ```bash
   npx prisma db seed --schema=prisma/schema.prod.prisma
   ```

## 4. Lancement

```bash
npm ci
npm run build
npm run start:prod
```

Le serveur écoute sur le port défini par `PORT` (défaut 3000). Le healthcheck est disponible sur `GET /health` (retourne 503 si la base est indisponible).

## 5. Docker (PostgreSQL)

Pour lancer le backend + PostgreSQL avec Docker :

```bash
cd aqera-backend-final-vrai
docker-compose up -d
```

- API : http://localhost:3000  
- Health : http://localhost:3000/health  
- Base PostgreSQL : `postgresql://aqera:aqera@localhost:5432/aqera`

Le premier démarrage applique le schéma avec `prisma db push`. Pour peupler les données de test, exécuter le seed depuis la machine hôte (ts-node requis) ou monter un volume avec un seed prévu pour Node.

## 6. Capacité

- **SQLite** : ordre de grandeur ~500–1 000 utilisateurs actifs (7 j) et ~50–100 marques (voir `docs/CAPACITY_ESTIMATE.md`).
- **PostgreSQL** : au-delà, utiliser PostgreSQL et les optimisations décrites dans `CAPACITY_ESTIMATE.md` (batch des `IN`, pagination admin).

## 7. Checklist pré-lancement

- [ ] `AUTH_SECRET` et `JWT_SECRET` différents en prod
- [ ] `DATABASE_URL` PostgreSQL en prod
- [ ] Migrations ou `db push` appliqués
- [ ] Seed exécuté une fois (admin) puis mot de passe admin changé
- [ ] `GET /health` retourne 200 avec `db: "up"` derrière un load balancer
