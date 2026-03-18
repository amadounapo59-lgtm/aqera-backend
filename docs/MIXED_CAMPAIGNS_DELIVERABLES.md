# AQERA – Mixed Campaigns (Campaign with multiple mission types)

## Summary

Brands can create a **mixed campaign** in one action: multiple mission types (e.g. 20 LIKE + 50 FOLLOW + 30 COMMENT) under one budget, one name, and one duration. Backward compatibility is preserved: single-mission creation (`POST /brands/missions`) and `GET /missions` for mobile are unchanged.

---

## 0) Repository & schema (existing)

- **Schemas**: `prisma/schema.prisma` (SQLite dev), `prisma/schema.prod.prisma` (PostgreSQL prod).
- **Models**: `Campaign` and `Mission.campaignId` already exist. No new migration was required for this feature.
- **Brand mission creation**: `POST /brands/missions` (single mission), `POST /brands/campaigns` (mixed campaign). Both are used by the Brand Dashboard.

---

## 1) Database (Prisma)

- **Campaign** (already present): `id`, `brandId`, `name`, `objective`, `platforms` (Json), `totalBudgetCents`, `durationDays`, `status`, `startsAt`, `endsAt`, `createdAt`, `updatedAt`.
- **Mission**: `campaignId` (optional) and relation to `Campaign` already present. Existing missions have `campaignId = null`.
- **Migrations**: None added; schema was already in place.

---

## 2) Business logic

- **Endpoint**: `POST /brands/campaigns`  
  Auth: `BRAND`, `BRAND_OWNER`, `BRAND_STAFF`, or `AGENCY`.  
  Body: `name`, `objective?`, `durationDays`, `platforms?`, `items[]` (each: `type`, `quantity`, `actionUrl`, `title?`, `description?`).
- **Pricing**: For each item, `MissionType` gives `userRewardCents` and `brandCostCents`.  
  `TotalCost = Σ(quantity × brandCostCents)`.  
  `internalFeeCents = items.length × 10` (0.10$ per mission type).  
  `TotalDebit = TotalCost + internalFeeCents`.
- **Accounting**: In one transaction: create `Campaign`, create all `Mission` rows with `campaignId`, update `BrandBudget.reservedForMissionsCents` by `TotalDebit`, update `CentralPool.reservedLiabilityCents` by `TotalCost` and `CentralPool.platformRevenueCents` (and related platform fields) by `internalFeeCents`.

---

## 3) Files changed

| Path | Change |
|------|--------|
| `aqera-backend-final-vrai/src/analytics/events.ts` | Added `brand_campaign_create_attempt`, `brand_campaign_create_success`, `brand_campaign_create_failed`. |
| `aqera-backend-final-vrai/src/brands/brands.controller.ts` | `POST /brands/campaigns`: async handler, analytics logging (attempt / success / failed). |
| `aqera-backend-final-vrai/scripts/smoke-test.sh` | Steps 9b (brand login), 9c (POST /brands/campaigns with 3 items, basic response check). |
| `aqera-web-dashboard-ui-final-v3-logoA_API_STABLE/src/app/brand/missions/page.tsx` | Added “Créer une campagne” section: name, duration, platforms, items (type + quantity + actionUrl), totals (cost + fee + total debit), submit. Single-mission form unchanged. |

**Unchanged (backward compatible)**:

- `POST /brands/missions` – single mission creation.
- `GET /missions` – still returns `availableMissions` / `completedMissions`; each mission may include optional `campaignId`.
- `GET /admin/accounting/summary` – already exposes `platformRevenueCents`.
- `GET /admin/campaigns` – already lists campaigns with brand, budget, missions count.

---

## 4) Example curl and expected response

**Request**

```bash
# 1) Login as brand
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"brand@blocafricain.com","password":"Brand123!"}' \
  | jq -r '.token')

# 2) Create mixed campaign
curl -s -X POST http://localhost:3000/brands/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Lancement produit X",
    "objective": "Awareness",
    "durationDays": 14,
    "platforms": ["instagram", "facebook"],
    "items": [
      {"type": "FOLLOW", "quantity": 50, "actionUrl": "https://www.instagram.com/leblocafricain/", "title": "Suivez-nous", "description": "Follow our page"},
      {"type": "LIKE", "quantity": 20, "actionUrl": "https://www.instagram.com/leblocafricain/", "title": "Likez le post", "description": "Like the post"},
      {"type": "COMMENT", "quantity": 30, "actionUrl": "https://www.instagram.com/leblocafricain/", "title": "Commentez", "description": "Leave a comment"}
    ]
  }'
```

**Expected response (200/201)**

```json
{
  "success": true,
  "campaign": {
    "id": 1,
    "name": "Lancement produit X",
    "status": "ACTIVE",
    "createdAt": "2026-02-27T12:00:00.000Z"
  },
  "missions": [
    { "id": 1, "title": "Suivez-nous", "missionTypeCode": "FOLLOW", "quantityTotal": 50, "quantityRemaining": 50, "status": "PENDING_APPROVAL" },
    { "id": 2, "title": "Likez le post", "missionTypeCode": "LIKE", "quantityTotal": 20, "quantityRemaining": 20, "status": "PENDING_APPROVAL" },
    { "id": 3, "title": "Commentez", "missionTypeCode": "COMMENT", "quantityTotal": 30, "quantityRemaining": 30, "status": "PENDING_APPROVAL" }
  ],
  "totalCostCents": 6900,
  "internalFeeCents": 30,
  "totalDebitCents": 6930
}
```

(`totalCostCents` depends on seed `MissionType` prices; `internalFeeCents = 3 × 10 = 30` for 3 items.)

---

## 5) Tests

- **Smoke**: `scripts/smoke-test.sh` includes brand login (9b) and `POST /brands/campaigns` with 3 items (9c). Run with backend up and DB seeded: `BASE_URL=http://localhost:3000 ./scripts/smoke-test.sh`.
- **Manual**: Use the Brand Dashboard → Missions → “Créer une campagne (plusieurs types de missions)”, then check Admin → Comptabilité and Admin → Campagnes.

---

## 6) Admin visibility

- **Total platform revenue**: `GET /admin/accounting/summary` returns `centralPool.platformRevenueCents` (includes internal fees from campaigns).
- **Campaign list**: `GET /admin/campaigns` returns campaigns with `brandName`, `totalBudgetCents`, `missionsCount`, `createdAt`.
