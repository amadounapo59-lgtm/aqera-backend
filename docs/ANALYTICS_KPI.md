# Analytics KPI V2/V3 — Tests manuels (curl)

Remplacez `BASE_URL` (ex: `http://localhost:3000`) et `JWT` par un token admin valide.

## 1. Recalcul (POST)

```bash
# Recalcul métriques du jour + user scores + mission performance
curl -X POST "$BASE_URL/admin/analytics/recompute" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"recomputeScores": true, "recomputePerformance": true}'

# Recalcul pour une date donnée
curl -X POST "$BASE_URL/admin/analytics/recompute" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"dateKey": "2025-02-27", "recomputeScores": true, "recomputePerformance": true}'
```

## 2. User Scores (TrustScore)

```bash
curl -s "$BASE_URL/admin/analytics/userscores?limit=20" \
  -H "Authorization: Bearer $JWT" | jq
```

## 3. Mission Performance

```bash
curl -s "$BASE_URL/admin/analytics/mission-performance" \
  -H "Authorization: Bearer $JWT" | jq
```

## 4. Métriques journalières (KPI V2)

```bash
curl -s "$BASE_URL/admin/metrics/daily?from=2025-02-20&to=2025-02-28" \
  -H "Authorization: Bearer $JWT" | jq
```

## Obtenir un JWT admin

Login avec un compte admin, récupérer le `token` dans la réponse :

```bash
curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"votre_mot_de_passe"}' | jq -r '.token'
```

Puis exporter : `export JWT="eyJhbGc..."`.
