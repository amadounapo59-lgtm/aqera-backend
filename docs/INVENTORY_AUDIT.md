# Audit — Stock de codes cadeaux (Option 1 : géré par ADMIN)

**Date:** 2026-02-28  
**Devise:** Dollar canadien (CAD) — tous les montants en cents (valueCents, balanceCents, etc.).  
**Objectif:** Vérifier l’existence des modèles et endpoints liés aux cartes cadeaux et à l’inventaire de codes, et documenter les écarts / risques.

---

## 1. Schéma Prisma — Modèles liés aux cartes cadeaux

| Composant | Statut | Détail |
|-----------|--------|--------|
| **GiftCard** | EXISTE | `id`, `brandId`, `valueCents`, `createdAt` ; `@@unique([brandId, valueCents])`. |
| **GiftCardPurchase** | EXISTE | `id`, `userId`, `giftCardId`, `code`, `status` (ACTIVE \| USED \| …), `clientRequestId`, `purchasedAt`, `usedAt`, `usedByUserId`, `inventoryItemId` (FK → inventaire). |
| **Brand** | EXISTE | Relation `giftCards GiftCard[]`. |
| **BrandBudget** | EXISTE | Indépendant ; utilisé pour dépôt / dépense marque. |
| **CentralPool** | EXISTE | Comptabilité globale (dont gift cards). |
| **Modèle d’inventaire de codes** | EXISTE | **GiftCardInventoryItem** (équivalent “GiftCardCode”) : `id`, `giftCardId`, `code` (unique), `status` (AVAILABLE \| ISSUED \| USED \| VOID), `issuedAt`, `usedAt`, `purchaseId`, `createdAt`, `updatedAt`. Index `@@index([giftCardId, status])`, `@@unique([code])`. |

**Conclusion schéma :** Aucun modèle manquant. L’inventaire est représenté par **GiftCardInventoryItem** (pas de nom “GiftCardCode”). Sémantique pilote : AVAILABLE → attribuable ; ISSUED → attribué à un achat ; USED → utilisé en magasin ; VOID → désactivé.

---

## 2. Endpoints backend existants

| Endpoint | Statut | Détail |
|----------|--------|--------|
| **POST /giftcards/purchase** | EXISTE | Auth user obligatoire ; idempotency via `Idempotency-Key` ; transaction atomique : choix d’un `GiftCardInventoryItem` AVAILABLE, création `GiftCardPurchase`, passage inventaire en ISSUED, débit wallet, ledger, CentralPool. |
| **GET /giftcards** | EXISTE | Catalogue des cartes (brand actif) ; pas d’auth obligatoire. |
| **GET /giftcards/my-purchases** | EXISTE | Liste des achats de l’utilisateur (JWT) ; retourne `purchases[]` avec `code`, `status`, `purchasedAt`, `usedAt`, `giftCard`. |
| **POST /giftcards/purchases/:id/use** | EXISTE | BRAND (ou ADMIN) ; marque la purchase en USED, `usedAt` / `usedByUserId`. **Manque :** mise à jour de l’inventaire lié (`GiftCardInventoryItem`) en USED. |
| **POST /giftcards/redeem** (by code) | EXISTE | BRAND ; redemption par `code` ; marque purchase USED **et** inventaire USED. |
| **Admin — import inventaire** | EXISTE | **POST /admin/giftcards/inventory/import** : body `{ brandId, valueCents, codes: string[] }` ; crée la GiftCard si besoin (brand+value), upsert des codes. Pas de route **giftCardId + codes** comme dans la spec “codes/import”. |
| **Admin — résumé inventaire** | EXISTE | **GET /admin/giftcards/inventory** : résumé par GiftCard (brandId, brandName, valueCents, comptes AVAILABLE/ISSUED/USED/VOID). Filtre optionnel `?brandId=`. |
| **Admin — liste codes (debug)** | MANQUE | Pas de GET paginé par `giftCardId` + filtre `status`. |
| **Admin — void code** | MANQUE | Pas de POST pour passer un code inventaire en VOID. |

---

## 3. UI Admin (gift cards)

| Composant | Statut | Détail |
|-----------|--------|--------|
| Pages / écrans admin dédiés inventaire | Non audité | À vérifier côté web dashboard (liste, import, summary). |
| Compatibilité mobile / web | OK | GET /giftcards et GET /giftcards/my-purchases utilisés par le client ; forme de réponse à préserver. |

---

## 4. Risques de compatibilité

| Risque | Niveau | Mitigation |
|--------|--------|------------|
| Réponse **my-purchases** | Faible | Enrichir avec `brandName`, `valueCents`, `usedAt` au niveau de l’objet purchase si absents, sans casser les champs existants (`code`, `status`, `purchasedAt`, `giftCard`). |
| Import par **giftCardId** | Faible | Ajouter une route **POST /admin/giftcards/codes/import** avec body `{ giftCardId, codes }` (et conserver l’ancienne route brandId+valueCents pour compatibilité). |
| **usePurchase** sans mise à jour inventaire | Moyen | Lors de POST /giftcards/purchases/:id/use, mettre à jour le `GiftCardInventoryItem` lié en USED + `usedAt` (cohérence avec redeem by code). |
| Double attribution de code | Faible | Déjà évité : sélection atomique dans une transaction (findFirst AVAILABLE + update ISSUED + create Purchase). |

---

## 5. Règle pilote (achat ↔ validation)

- **À l’achat :** un code inventaire passe **AVAILABLE → ISSUED** ; `GiftCardPurchase` créé avec `status ACTIVE`, `code` copié, `inventoryItemId` renseigné.
- **À la validation (brand/admin) :**  
  - **POST /giftcards/purchases/:id/use** ou **POST /giftcards/redeem** (by code)  
  → `GiftCardPurchase.status = USED`, `usedAt` / `usedByUserId` ;  
  → `GiftCardInventoryItem` lié : `status = USED`, `usedAt` (à appliquer aussi dans `usePurchase`).

---

## 6. Synthèse

| Élément | Statut |
|---------|--------|
| Modèles Prisma (GiftCard, Purchase, Inventory) | EXISTE |
| Inventaire (GiftCardInventoryItem) | EXISTE |
| POST /giftcards/purchase (atomique, stock) | EXISTE |
| GET /giftcards, GET /giftcards/my-purchases | EXISTE |
| POST /giftcards/purchases/:id/use | EXISTE (inventaire non mis à jour) |
| POST /giftcards/redeem (by code) | EXISTE |
| Admin import (brandId + valueCents + codes) | EXISTE |
| Admin import (giftCardId + codes) | MANQUE → à ajouter |
| Admin summary inventaire | EXISTE (sous /admin/giftcards/inventory) |
| Admin GET codes (pagination + filtre) | MANQUE (optionnel) |
| Admin void code | MANQUE (optionnel) |

**Actions recommandées :**  
1) Lors de **usePurchase**, mettre à jour l’inventaire lié en USED.  
2) Ajouter **POST /admin/giftcards/codes/import** (giftCardId + codes) et **GET /admin/giftcards/codes/summary** (alias ou même forme que l’inventory actuel).  
3) Enrichir **my-purchases** (brandName, valueCents, usedAt).  
4) (Optionnel) GET /admin/giftcards/codes, POST /admin/giftcards/codes/:id/void.

---

## 7. Actions réalisées (post-audit)

| Action | Fait |
|--------|------|
| Nouveau modèle Prisma type GiftCardCode | Non — **GiftCardInventoryItem** conservé (équivalent). |
| **usePurchase** met à jour l’inventaire en USED | Oui — dans une transaction : purchase USED + `GiftCardInventoryItem` lié → USED, `usedAt`. |
| **POST /admin/giftcards/codes/import** (giftCardId + codes) | Oui — déduplication des codes, rejet des vides, `insertedCount` / `skippedCount`. |
| **GET /admin/giftcards/codes/summary** | Oui — alias de l’inventory summary avec `availableCount`, `reservedCount` (ISSUED), `usedCount`, `total`. |
| **GET /admin/giftcards/codes** (pagination, filtre) | Oui — `?giftCardId=&status=&page=&limit=`. |
| **POST /admin/giftcards/codes/:id/void** | Oui — passage du code en VOID (refus si déjà USED). |
| **my-purchases** enrichi | Oui — `brandName`, `valueCents`, `usedAt` au niveau de chaque purchase. |
| Import existant (brandId + valueCents) | Corrigé — déduplication des codes, comptes `insertedCount` / `skippedCount` corrects. |
| Seed | Carte 50 $ CAD ajoutée ; 2–3 codes fake pour 20 $ CAD et 50 $ CAD. |
| TEST_CHECKLIST | Section 3.9 + scénario de test rapide (import → earn → purchase → use). |
