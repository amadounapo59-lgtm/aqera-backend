# AQERA Backend — Estimation de capacité (état actuel)

Ce document estime **combien d’utilisateurs et de marques actifs** l’application peut supporter **sans bug** dans son état actuel (pilote), selon la base de données utilisée.

---

## Résumé rapide

| Contexte | Utilisateurs (ordre de grandeur) | Marques actives (ordre de grandeur) |
|----------|-----------------------------------|-------------------------------------|
| **SQLite (dev / petit pilote)** | **~500–1 000** actifs sur 7 j | **~50–100** |
| **PostgreSQL (prod)** | **~5 000–10 000+** (limité surtout par le serveur) | **~200–500** (puis pagination admin à prévoir) |

Les limites ci‑dessous expliquent ces fourchettes et ce qu’il faudrait adapter pour monter en charge.

---

## 1. Limites par composant

### 1.1 Rate limits (sécurité pilote)

Configurables via `.env` (valeurs par défaut) :

- **Inscription** : 5 / IP / heure  
- **Connexion** : 20 / IP / 15 min  
- **Soumission de mission** : 40 / utilisateur / heure  
- **Redeem (mode caisse)** : 60 / staff / 15 min  
- **Achat carte cadeau** : 10 / utilisateur / jour  

Ils ne limitent pas le nombre total d’utilisateurs ou de marques, mais le débit par IP/utilisateur. Au‑delà, les requêtes reçoivent 429 (Too Many Requests), pas de bug applicatif.

### 1.2 Pagination et `take` déjà en place

- **Missions (user)** : 200 missions actives + 200 tentatives max par appel.  
- **Admin** : attempts, missions, brand applications, alerts, security events, user scores, risk users : limites 20–200 selon l’endpoint.  
- **Wallet** : 200 dernières transactions.  
- **Brand** : redeems, missions : take 100–200.  

Ces endpoints restent maîtrisés en volume.

### 1.3 Requêtes sans limite de pagination (risque à la montée en charge)

- **GET /giftcards** (catalogue) : charge **toutes** les cartes cadeaux (marques actives).  
  → Raisonnable tant que “nombre de marques × cartes par marque” reste modéré (ex. &lt; 500 lignes).
- **Admin listBrands** : charge **toutes** les marques (avec users, _count).  
  → Au‑delà de ~100–200 marques, temps de réponse et charge mémoire augmentent.
- **Staff par marque** : liste tous les staff d’une marque (sans `take`).  
  → Généralement &lt; 50 par marque, acceptable en pilote.

### 1.4 Limite SQLite : clause `IN` (paramètres)

En **SQLite**, le nombre de paramètres par requête est limité (souvent **999**). Le code utilise parfois :

- `userId: { in: activeUserIds }`  
- `userId: { in: cohortUserIds }`  
- `userId: { in: baseUserIds }`  
- `id: { in: Array.from(userIds) }`  

**Où c’est utilisé :**

- **ScoreService.recomputeUserScores()** : tous les utilisateurs “actifs” sur 7 j (eventLog) → `activeUserIds` peut être grand ; 4 requêtes avec `in: activeUserIds`.  
  → Dès que **nombre d’utilisateurs actifs sur 7 j > ~999**, risque d’erreur SQLite.
- **DailyMetricsService.recomputeDailyMetrics()** : cohorte du jour, DAU du jour → `cohortUserIds` / `baseUserIds`.  
  → Même risque si **inscriptions ou DAU du jour > ~999**.
- **Admin getRiskUsers** : tous les userId ayant soumis / été reviewés sur 7 j → `userIds`.  
  → Si plus de ~999 tels users, la requête user.findMany peut échouer en SQLite.

En **PostgreSQL**, cette limite pratique est bien plus haute (ordre 10k+), donc le plafond “sans bug” monte surtout avec le volume de données et la puissance du serveur.

### 1.5 Autres jobs “lourds”

- **recomputeMissionTypePerformance()** : charge toutes les tentatives + events sur 7 j (sans `take`).  
  → Volume proportionnel aux missions et aux soumissions ; au‑delà de quelques dizaines de milliers de lignes, à exécuter en tâche de fond et/ou à paginer.
- **recomputeUserScores()** : en plus du `IN`, boucle sur `activeUserIds` avec un `upsert` par user.  
  → Des milliers d’utilisateurs actifs = beaucoup de requêtes séquentielles ; à garder pour des batchs ou en job asynchrone.

---

## 2. Synthèse par scénario

### 2.1 SQLite (dev / petit pilote)

- **Utilisateurs** :  
  - Pour éviter les bugs liés au `IN` : **&lt; ~500–1 000 utilisateurs actifs sur 7 j** (et DAU / inscriptions du jour &lt; ~999 si possible).  
  - Au‑delà, `recomputeUserScores`, `recomputeDailyMetrics` ou `getRiskUsers` peuvent échouer (erreur SQLite ou timeout).
- **Marques** :  
  - **&lt; ~50–100 marques actives** pour garder listBrands et catalogue giftcards fluides et sans surprise.

### 2.2 PostgreSQL (prod)

- **Utilisateurs** :  
  - Plus de marge sur le `IN` (pas la limite 999).  
  - Ordre de grandeur **~5 000–10 000+ utilisateurs actifs** tant que le serveur (CPU/RAM) et le débit restent corrects ; les goulots sont alors plutôt les jobs d’analytics (recompute) et les listes non paginées.
- **Marques** :  
  - **~200–500 marques actives** possibles ; au‑delà, il est recommandé d’ajouter une **pagination** sur listBrands et éventuellement sur le catalogue giftcards.

---

## 3. Recommandations pour augmenter la capacité

1. **Remplacer SQLite par PostgreSQL** en production pour lever la limite des 999 paramètres et mieux gérer la concurrence.
2. **Paginer ou limiter** les requêtes avec `in: list` (ex. traiter les `activeUserIds` par lots de 500–1000 dans ScoreService et DailyMetrics).
3. **Pagination admin** : listBrands et, si besoin, catalogue giftcards (ex. par marque ou par page).
4. **Jobs d’analytics** (recomputeUserScores, recomputeMissionTypePerformance, recomputeDailyMetrics) : les lancer en **tâche de fond** (cron/job queue) plutôt que dans la requête HTTP si le volume grossit.
5. **Index** : vérifier que les index Prisma (eventLog, missionAttempt, etc.) couvrent les filtres par date et userId pour éviter les full table scans.

---

## 4. Conclusion

- **Aujourd’hui, “sans bug”** :  
  - **SQLite** : de l’ordre de **500–1 000 utilisateurs actifs (7 j)** et **50–100 marques actives**.  
  - **PostgreSQL** : de l’ordre de **5 000–10 000+ utilisateurs** et **200–500 marques**, avec les évolutions ci‑dessus (pagination admin, batch des `IN`, jobs en async) pour aller au‑delà.

Les chiffres exacts dépendent du matériel, du trafic et du volume d’events ; ce document donne des ordres de grandeur et les points du code à surveiller ou adapter.
