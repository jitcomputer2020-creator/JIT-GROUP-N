# JIT GROUP Firestore Security Specification

## 1. Architecture & Data Invariants
JIT GROUP uses passwordless, OTP-free Contact Number account lookup across all browsers, devices, and incognito sessions:
- **`/phone_index/{phoneKey}`**: Maps normalized phone digits (`^[0-9]{7,15}$`) to `{ profileId, createdAt, lastLoginAt }`. Contains zero PII (no names, no addresses, no raw contact strings). `allow list: if false;` prevents enumeration of registered phone numbers.
- **`/profiles/{profileId}`**: Stores full `UserProfile` documents keyed by unguessable `profileId` (`^[a-zA-Z0-9_-]{8,64}$`). `allow list: if false;` prevents scraping of user profiles. Single-document `get` requires knowing the exact `profileId`.
- **180-Day Inactivity Expiration**: Both `/phone_index/{phoneKey}` and `/profiles/{profileId}` track server-verified timestamps (`lastLoginAt` / `lastActiveAt == request.time`). Deletion is ONLY permitted when `request.time > existing().lastActiveAt + duration.value(180, 'd')` (or `existing().lastLoginAt + duration.value(180, 'd')`).
- **Atomic Registration Invariant**: Creating a `/phone_index/{phoneKey}` document requires `existsAfter(/databases/$(database)/documents/profiles/$(incoming().profileId))`, guaranteeing no orphaned phone index entries.
- **Immutability Invariant**: On profile updates, `id`, `phoneKey`, and `joinedAt` are strictly immutable (`incoming().field == existing().field`).

## 2. The "Dirty Dozen" Adversarial Payloads
Every write/read path must reject (`PERMISSION_DENIED`) the following 12 attack payloads:

1. **Blanket List Enumeration (`phone_index`)**: `list` query on `/phone_index` to scrape all registered numbers -> `PERMISSION_DENIED`.
2. **Blanket List Enumeration (`profiles`)**: `list` query on `/profiles` to dump all user PII -> `PERMISSION_DENIED`.
3. **Document ID Poisoning (`phone_index`)**: `set` on `/phone_index/not_a_phone_1500chars...` -> `PERMISSION_DENIED` (fails `isValidPhoneKey`).
4. **Document ID Poisoning (`profiles`)**: `set` on `/profiles/bad!id$inject` -> `PERMISSION_DENIED` (fails `isValidId`).
5. **Shadow / Ghost Field Injection**: `create` on `/profiles/{id}` with extra field `isAdmin: true` or `role: "superadmin"` -> `PERMISSION_DENIED` (fails `keys().hasOnly(...)`).
6. **Orphaned Phone Index**: `create` on `/phone_index/9874492871` without an atomic batch create of `/profiles/{profileId}` -> `PERMISSION_DENIED` (fails `existsAfter(...)`).
7. **Timestamp Spoofing on Create**: `create` on `/profiles/{id}` with backdated `lastActiveAt` instead of `request.time` -> `PERMISSION_DENIED`.
8. **Timestamp Spoofing on Update**: `update` on `/profiles/{id}` attempting to set `lastActiveAt` to a past/future client timestamp -> `PERMISSION_DENIED`.
9. **Immutable Identity Hijack**: `update` on `/profiles/{id}` attempting to change `phoneKey`, `id`, or `joinedAt` -> `PERMISSION_DENIED`.
10. **Denial-of-Wallet String Bomb**: `create` or `update` on `/profiles/{id}` with `fullName` > 120 chars or `bio` > 500 chars or `address` > 300 chars -> `PERMISSION_DENIED`.
11. **Value Type Poisoning**: `update` on `/profiles/{id}` setting `stats.rewardPoints` to a negative integer (`-999`) or string `"1000"` -> `PERMISSION_DENIED`.
12. **Premature Account Deletion**: `delete` on `/profiles/{id}` or `/phone_index/{phoneKey}` whose `lastActiveAt` / `lastLoginAt` is less than 180 days old -> `PERMISSION_DENIED`.
