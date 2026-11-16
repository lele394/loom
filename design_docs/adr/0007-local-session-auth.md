# ADR 0007 — Local session authentication

**Status:** Accepted

## Context

"Basic auth would be nice" (user) and "Authentik or native" (source design). The default deployment is a local server with no identity provider. Research data is sensitive and the instance may be exposed on a LAN or via a reverse proxy.

## Decision

- First-run setup creates one admin account; no open registration.
- Passwords hashed with scrypt (N=16384, r=8, p=1), constant-time verification, generic errors, timing equalisation.
- Server-side sessions: random 256-bit token, SHA-256 stored, HttpOnly SameSite=Lax cookie, 30-day sliding expiry.
- CSRF double-submit token bound to the session, required on all unsafe methods, plus Origin validation.
- Login/setup rate limits.
- Keys/secrets encrypted with AES-256-GCM using an instance master key.

## Consequences

- Zero external dependencies; works offline; simple mental model.
- No SSO/passkeys/2FA in v1; OIDC can be added as a strategy without changing authorization checks.
- Password reset requires filesystem access (CLI), appropriate for self-hosting.
- Session rows are bearer-equivalent; database access is game over (documented).

## Alternatives rejected

- **HTTP Basic auth:** no logout, browser UX, no CSRF story, credentials on every request.
- **JWT in localStorage:** XSS-exposed, no server-side revocation.
- **Authentik/OIDC only:** breaks the "run locally in one command" requirement.
