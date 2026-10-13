# Kitpier — app store for AI-built software (PayPal hackathon)

Spec (LOCKED, changes need user approval): `../SPEC.md`. Council report: `../docs/council-2026-10-14.md`.

## Run
- DB (project-local Postgres 17, port 5433, localhost only):
  `pg_ctl -D .pgdata -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" -l .pgdata/server.log start`
- `npm run db:migrate` (dev) · test DB: `MIGRATE_URL=postgres://kitpier@127.0.0.1:5433/kitpier_test node scripts/migrate.mjs`
- `npm run dev` → http://localhost:3005 (fixed port)
- Checks: `npx tsc --noEmit && npx eslint src && npx vitest run && npm audit --omit=dev`
- Webhooks locally need a tunnel + registered webhook id in `PAYPAL_WEBHOOK_ID`; close the tunnel and delete the webhook after.

## Non-obvious rules
- Money is integer micro-USD. Every ledger effect has a UNIQUE `source` (capture:/refund:/reversal:/usage:) — that is the idempotency.
- Credits only via `applyVerifiedOrderTx` (GET-verified order: merchant id, custom_id, amount, currency). Three paths feed it (browser capture, ORDER.APPROVED, CAPTURE.COMPLETED) — keep them converging on it.
- Never hold a DB transaction across PayPal/Claude calls (`tx()` is DB-only).
- Webhooks: verify signature first; 4xx from PayPal verify = unverified (401); claim event id and apply effects in one tx.
- Every project-scoped access goes through `requireProjectOwner` (404 for others). Mutating routes use `route(fn, { mutating: true })` (origin = APP_URL).
- Next 16 Cache Components: session-reading UI goes inside `<Suspense>`; `getSession()` calls `connection()`. No `export const dynamic`.
- Secrets only in `.env.local` (600, gitignored). `.pgdata/`, `*.log`, `spikes/`, `.brain/` are gitignored — stage explicit paths.
