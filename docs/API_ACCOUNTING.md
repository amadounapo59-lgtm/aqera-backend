# Accounting API (Admin)

**Auth:** JWT + role `ADMIN`.

**Invariant:** `CentralPool.reservedLiabilityCents` = `SUM(BrandBudget.reservedForMissionsCents)` + `SUM(User.pendingCents + User.availableCents)`.

---

## GET /admin/accounting/summary

Returns the central pool row, aggregated sums from brands and users, recomputed reserved liability, and a consistency status.

**Response (200):**

```json
{
  "centralPool": {
    "id": 1,
    "totalDepositedCents": 0,
    "reservedLiabilityCents": 0,
    "totalSpentCents": 0,
    "platformRevenueCents": 0,
    "platformMarginCents": 0,
    "platformAvailableCents": 0,
    "platformSpentCents": 0
  },
  "sums": {
    "brandDeposited": 0,
    "brandReserved": 0,
    "brandSpent": 0,
    "userPendingTotal": 0,
    "userAvailableTotal": 0
  },
  "recomputedReservedLiability": 0,
  "status": "OK",
  "diffs": null
}
```

- **status** `"OK"`: `centralPool.reservedLiabilityCents == recomputedReservedLiability`, `totalDepositedCents == brandDeposited`, `totalSpentCents == brandSpent`.
- **status** `"MISMATCH"`: at least one invariant fails; **diffs** contains `reservedLiability`, `totalDeposited`, `totalSpent` (stored − recomputed).

---

## POST /admin/accounting/reconcile

Recomputes and overwrites CentralPool (id=1) from current sums. Idempotent.

**Body:** none (or `{}`).

**Response (200):**

```json
{
  "success": true,
  "totalDepositedCents": 0,
  "reservedLiabilityCents": 0,
  "totalSpentCents": 0
}
```

Updates:

- `totalDepositedCents` = SUM(BrandBudget.totalDepositedCents)
- `totalSpentCents` = SUM(BrandBudget.spentCents)
- `reservedLiabilityCents` = SUM(BrandBudget.reservedForMissionsCents) + SUM(User.pendingCents) + SUM(User.availableCents)

Platform fields (`platformRevenueCents`, `platformMarginCents`, etc.) are left unchanged by reconcile.
