# Limiter les inscriptions avec des emails non réels

## Problème

Aujourd’hui, n’importe qui peut créer un compte avec n’importe quelle adresse email (y compris des adresses jetables ou inexistantes).

## Ce qui est en place (sans rien casser)

### 1. Blocage des domaines jetables (activé par défaut)

- **Fichier** : `src/auth/disposable-email-domains.ts` (liste) + vérification dans `auth.service.ts` au moment du `register`.
- Les inscriptions avec un domaine connu d’email temporaire (tempmail, guerrillamail, mailinator, yopmail, etc.) sont **refusées** avec un message clair.
- **Config** : `SECURITY_BLOCK_DISPOSABLE_EMAIL=false` dans `.env` pour désactiver (ex. tests).
- **Impact** : Aucun changement pour les comptes existants ni pour le login. Seule l’inscription est concernée.

### 2. Restriction achat selon vérification email (désactivée par défaut)

- Les nouveaux utilisateurs ont `emailVerified: false`.
- Par défaut, **l’achat de cartes cadeaux est autorisé** même sans email vérifié.
- Pour exiger une vérification email avant achat : mettre `SECURITY_REQUIRE_EMAIL_VERIFIED_FOR_PURCHASE=true` dans `.env`. Dans ce cas, seuls les utilisateurs avec `emailVerified: true` (mis par un admin ou par un futur flux de vérification) pourront acheter des cartes.

---

## Autres options possibles (non mises en place)

### Option A : Vérification email (lien ou code)

- À l’inscription : envoi d’un email avec un lien ou un code.
- L’utilisateur clique sur le lien ou saisit le code → `emailVerified` passé à `true`.
- **Pour ne rien casser** : migration qui met `emailVerified = true` pour tous les utilisateurs existants.
- **Nécessite** : config d’envoi d’emails (SMTP, SendGrid, Resend, etc.) et une route du type `GET /auth/verify-email?token=xxx` ou `POST /auth/verify-email` avec un token/code stocké (table ou champ dédié).

### Option B : CAPTCHA à l’inscription

- Ajouter un CAPTCHA (reCAPTCHA, hCaptcha, etc.) sur le formulaire d’inscription et vérifier la réponse côté backend.
- Réduit les inscriptions bots / automatisées, mais ne garantit pas que l’email est réel.

### Option C : Liste de domaines autorisés (allowlist)

- N’accepter que certains domaines (ex. `@entreprise.com`). Utile en usage interne, pas pour une app grand public.

### Option D : Vérification “email existe” via un service tiers

- Appeler une API qui vérifie si la boîte mail existe (MX + existence de la mailbox). Coût, dépendance externe et pas toujours fiable ; à considérer avec prudence.

---

## Résumé

- **Activé maintenant** : blocage des domaines jetables à l’inscription. L’achat de cartes est autorisé sans vérification d’email (par défaut).
- **Optionnel** : mettre `SECURITY_REQUIRE_EMAIL_VERIFIED_FOR_PURCHASE=true` pour exiger un email vérifié avant achat.
- **Optionnel plus tard** : envoi d’un email de vérification + lien/code pour passer `emailVerified` à `true`, après migration des utilisateurs existants.
