# MissionPay public deploy runbook (Vercel + Neon, about 15 minutes)

Target: judge-facing pages live on a public URL, `PAYMENT_MODE=LIVE_FUJI`, **no signing keys on the server**.
Steps marked **[OWNER]** need your hands (accounts, secrets, dashboards). Nothing here was run for you: no deploy, push, or account was created.

Judge-facing pages and what they need:

| Page | Needs DB | Needs env | Evidence |
|---|---|---|---|
| `/judge` (`/api/judge/receipts`, `/api/judge/simulate`) | no | none (RPC optional) | `apps/web/lib/judge-service.ts:62-84` (file, else hard-coded fallback), `:113-117` (RPC default) |
| `/arena/twin` (`/api/arena/twin`) | no | none, but `evidence/twin/*.json` must ship | `apps/web/app/api/arena/twin/route.ts:9-35` (no fallback: returns `NOT_RUN` without the files) |
| `/` home (`/api/missions`) | yes | none | `apps/web/app/api/missions/route.ts:54-60` lists `publicPublished` missions only |
| `/verify/<slug>` (`/api/verify/[missionId]`) | yes (`demo-seed` id needs no DB) | none (RPC optional) | `apps/web/app/api/verify/[missionId]/route.ts:27,127,214,248` |
| `/bounty` (`/api/bounty/attempt`) | yes | `LLM_API_KEY` for live attempts | `apps/web/lib/bounty.ts:359-366` |

## 1. Create the database [OWNER]

1. neon.tech: create a free project (region close to your Vercel region, e.g. `aws-us-east-1`).
2. Copy two connection strings from the dashboard:
   - **Pooled** (host contains `-pooler`) -> `DATABASE_URL`, append `&pgbouncer=true`
   - **Direct** (no `-pooler`) -> `DIRECT_URL`

   Both need `?sslmode=require`.

## 2. Migrate and seed (from your machine) [OWNER]

Run from the repo root. Export the Neon URL in the shell first. The seed script only reads `apps/web/.env` for variables that are NOT already set (`scripts/lib/mission-audit.ts:297`), so exporting protects you from seeding your local DB by accident. The script prints the DB name: check it.

```bash
export DATABASE_URL='<neon DIRECT url>'     # direct string for migrate + seed
export DIRECT_URL="$DATABASE_URL"
npm ci
npx prisma migrate deploy --schema apps/web/prisma/schema.prisma
npx tsx scripts/seed-mission-audit.ts --slug fuji-live-mission-s1c
```

Expected seed output: `[seed] DB: <neon db name> | slug: fuji-live-mission-s1c ...` then `Chain VALID after seed: 3 entries`.
Re-running is safe (idempotent upsert).

Do NOT seed `fork-dryrun-s1c` on the public DB (local-fork dry run, not Fuji evidence).
The twin evidence for `/judge` and `/arena/twin` is read from files, not the DB (step 3).

## 3. Ship the evidence files [OWNER]

`/api/arena/twin` and `/api/judge/receipts` read `evidence/twin/twin.live.json` relative to `process.cwd()` (`apps/web` on Vercel). Copies live in `apps/web/evidence/twin/`. A local `next build` confirmed Next's file tracing includes them (`.next/server/app/api/arena/twin/route.js.nft.json`).

- `git add apps/web/evidence/twin/` and commit. They are untracked now; a Git-based deploy will not see untracked files.
- If `evidence/twin/twin.live.json` changes, re-copy it into `apps/web/evidence/twin/`.
- `/judge` still works without them (hard-coded `FALLBACK_TWIN_EVIDENCE`); `/arena/twin` would show `NOT_RUN`.

## 4. Vercel project [OWNER]

1. vercel.com -> Add New Project -> import the repo.
2. Settings:
   - Framework: Next.js
   - **Root Directory: `apps/web`**
   - **"Include source files outside of the Root Directory": ON** (default; needed for the npm workspace `@missionpay/guard` in `packages/guard`)
   - Node.js version: **20.x**
   - Install and Build commands: already set by `apps/web/vercel.json` (`cd ../.. && npm ci`; then `prisma generate`; then root `npm run build`, which builds `@missionpay/guard` before the web app). `packages/guard/dist` is git-ignored, so this ordering is mandatory. Leave the dashboard overrides empty.
   - Function max duration: `vercel.json` sets 60s for `/api/bounty/attempt`. Hobby plan allows it.
3. Set the env vars from step 5 **before** the first deploy. `PAYMENT_MODE` is read at build time by `apps/web/app/layout.tsx:22` and baked into prerendered pages; changing it later needs a redeploy.
4. Deploy. (`next/font/google` downloads Geist/Archivo at build time; Vercel build has network, an offline machine would not.)

## 5. Environment variables

### REQUIRED for the judge-facing set in `PAYMENT_MODE=LIVE_FUJI`

| Name | Example placeholder | Where used |
|---|---|---|
| `DATABASE_URL` | `postgresql://<user>:<pw>@<ep>-pooler.<region>.aws.neon.tech/<db>?sslmode=require&pgbouncer=true` | `apps/web/lib/db.ts:6-8` (pg Pool; if unset it silently falls back to a localhost URL, so a missing value shows up as DB errors at runtime, not a build failure) |
| `DIRECT_URL` | `postgresql://<user>:<pw>@<ep>.<region>.aws.neon.tech/<db>?sslmode=require` | `apps/web/prisma/schema.prisma:4` (migrations only; not used at runtime) |
| `PAYMENT_MODE` | `LIVE_FUJI` | `apps/web/app/layout.tsx:22` header badge; `apps/web/lib/config.ts:56-62` |

That is all. `/judge`, `/arena/twin`, `/`, `/verify/<slug>` work with only these.

### RECOMMENDED / OPTIONAL

| Name | Example placeholder | Effect | Where used |
|---|---|---|---|
| `AVALANCHE_FUJI_RPC_URL` | `https://api.avax-test.network/ext/bc/C/rpc` | Dedicated RPC (Alchemy/QuickNode) avoids public-RPC rate limits on `/judge` and `/verify`. Default is the public Ava Labs endpoint. | `lib/judge-service.ts:113-116`, `app/api/verify/[missionId]/route.ts:214`, `app/api/health/route.ts`, `lib/bounty.ts` |
| `LLM_API_KEY` (or `GEMINI_API_KEY`) | `<google-ai-studio-key>` (starts `AIza`) | Enables live `/bounty` attempts. **Without it `POST /api/bounty/attempt` returns 503 `LLM_UNAVAILABLE`; there is NO deterministic fallback** (`lib/bounty.ts:358-366`, `app/api/bounty/attempt/route.ts:121-134`). The old checklist claim of a fallback was wrong. The page still loads and shows stats. | `lib/bounty.ts:359` |
| `TRUSTED_INGRESS` | leave unset | Unset on Vercel: all bounty callers share one rate-limit bucket (5/min, 300/day global), the safe default. Valid values are only `cloudflare`/`gcp`. | `lib/bounty.ts:105-126` |
| `ARENA_PRESENTER_KEY` | `<long-random>` | Only for the `/stage` reset button. Unset = reset disabled. | `lib/arena.ts`, `app/stage/actions.ts` |
| `BOUNTY_SALT` | `<random>` | Salt for IP hashing; a hard-coded default exists. Set a random value on public deploys. | `lib/bounty.ts:68` |
| `NEXT_PUBLIC_STAGE` | `S1` | Header stage badge; default `S1`. | `app/layout.tsx:23` |
| `GUARDED_TREASURY_ADDRESS`, `NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS`, `NEXT_PUBLIC_ERC8004_AGENT_ID` | see `docs/deploy/DEPLOY_CHECKLIST.md` | All have working in-code defaults for the verified Fuji deployment; set only to override. | `lib/config.ts` (getGuardedTreasuryAddress), `app/api/verify/[missionId]/route.ts:248-268` |

`APP_ORIGIN`, `DEPLOYMENT_ID`, `MISSION_TOKEN_SECRET`, `OWNER_ADDRESS` are only needed for wallet-signed mission creation / token minting (`lib/auth.ts:199-278`). Judges do not need them; leave unset on the public site.

### MUST NOT be set on the public deploy

| Name | Why | Behaviour if absent |
|---|---|---|
| `AGENT_PRIVATE_KEY` | Signs x402 payments (`lib/payments.ts:539`) and tool authorizations (`app/api/tools/[id]/route.ts:97`, `app/api/tools/operations/[id]/reserve/route.ts`, `app/api/tools/orchestrate/route.ts`, `app/api/tools/talkmeter/tick/route.ts`, `app/api/agent/run/route.ts:582`). These are spend-token gated, but no judge page needs them. | In LIVE_FUJI `validateLiveFujiConfig()` throws before any signing (`lib/config.ts` (`validateLiveFujiConfigSync`, AGENT_PRIVATE_KEY check); called at `app/api/agent/run/route.ts:32`, `app/api/tools/orchestrate/route.ts:19`, `lib/payments.ts:51,197,423`). Routes fail closed with an error; nothing is signed. `/api/policy` reports no agent address (`app/api/policy/route.ts:50-56`). |
| `RELAYER_PRIVATE_KEY`, `FACILITATOR_PRIVATE_KEY` | **Highest risk.** `POST /api/passkey/relay` is a public endpoint that broadcasts a transaction paid by this key (`app/api/passkey/relay/route.ts:292-357`); `lib/facilitator-fallback.ts:62-91` also broadcasts with it. | Relay broadcast path returns 503 "Relayer service not configured" (`route.ts:292-297`). The read-only simulation path (earlier in the handler) still works. Facilitator returns `null`. |
| `VALIDATOR_PRIVATE_KEY` | Only used by the M7 validator worker (`lib/validator-job.ts:1491,2135`), run via `npm run worker:validation`. No `app/` route calls `runMissionValidatorJob`. | Worker is not running on Vercel anyway; keep the key on your own machine. |
| `BOUNTY_INTERNAL_SECRET` | Lets a caller classify bounty attempts as `test`/`smoke` and hide them from public stats (`app/api/bounty/attempt/route.ts:40-52`). | Everyone is `public` (wanted). |
| `STUB_BOUNTY_LLM`, `STUB_BOUNTY_SIMULATION`, `TEST_CLIENT_IP_ENABLED`, `TEST_ALLOW_UNVERIFIED_CREATION_BLOCK`, `ALLOW_AGENT_TEST_OVERRIDE`, `DEMO_ADVERSARIAL`, `MISSIONPAY_EVAL` | Test/eval switches: fake the LLM, trust spoofable IP headers (`lib/bounty.ts:116`), or relax checks. | Production behaviour. |
| `SESSION_WALLET_SEED` | Derives per-mission wallet keys (`lib/session-wallets.ts:52`). Not needed for judge pages. | Session wallet derivation unavailable (no judge impact). |

Never expose any of these as `NEXT_PUBLIC_*`.

## 6. Smoke tests (replace `$URL`)

1. `curl -s $URL/api/health` -> `status: "healthy"`, database `connected`, `actualChainId: 43113`. If the database shows an error, re-check `DATABASE_URL`.
2. `curl -s $URL/api/judge/receipts` -> `"success":true` with 3 receipts. The attack receipt has `status: "reverted"`, `revertReason: "PayeeNotInMissionSet"` (`lib/judge-service.ts:169-173`).
3. Random address, expect a block:
   `curl -s -X POST $URL/api/judge/simulate -H 'content-type: application/json' -d '{"recipient":"0x000000000000000000000000000000000000dEaD","amountAtomic":10000}'`
   -> `"outcome":"REVERT"`, `"revertReason":"PayeeNotInMissionSet"`. Note `classifyError` (`lib/judge-service.ts:~296-308`) maps unknown revert text to `PayeeNotInMissionSet` and checks `missionBExpiry` in the response: if Mission B has expired on Fuji the reasons can change (`MissionExpired`); check that field if a result looks off.
   Owner address `0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c` (positive control) -> `"outcome"` success, `isOwnerPositiveControl: true`. Limits: 10 requests/min/IP, body under 2 KB, amount 1-10000.
4. `curl -s $URL/api/arena/twin` -> `"status":"LIVE"`. `NOT_RUN` or `SIMULATED` means the evidence files did not ship (step 3).
5. `curl -s $URL/api/missions` -> 1 mission, `fuji-live-mission-s1c`.
6. Browser: `$URL/verify/fuji-live-mission-s1c` shows a valid 3-entry chain; `$URL/verify/demo-seed` shows the offline seed.
7. Browser: `$URL/judge`, `$URL/arena/twin`, `$URL/bounty`, `$URL/`. Header shows LIVE_FUJI.
8. `/bounty` live attempt: 503 `LLM_UNAVAILABLE` unless `LLM_API_KEY` is set. Not a bug.
9. `curl -s $URL/api/policy` -> `agentAddress: null` (confirms no signing key is present).

## 7. Rollback

- Bad deploy: Vercel -> Deployments -> previous good one -> "Promote to Production" (instant, no rebuild).
- Bad env var: fix in Settings, then Redeploy (build-time vars such as `PAYMENT_MODE` need a rebuild).
- Bad seed: seeding is idempotent. To reset fully, recreate the Neon branch/DB and rerun step 2.
- Emergency: Vercel -> Settings -> pause project; present from a local `npm run dev` with `/verify/demo-seed` as the offline fallback.

## Known limits

- `/api/judge/simulate` rate limit is in-memory per serverless instance; with several instances the effective limit is higher. Harmless (read-only `eth_call`).
- Neon free tier cold-starts (about 1 s on the first query). Hit `/api/health` once before presenting.
- `lib/validator-job.ts:2311-2318` tries to write evidence files; Vercel's filesystem is read-only, and the write is wrapped in try/catch.
- `apps/web/prisma/migrations/migration_lock.toml` is absent; `migrate deploy` is not known to need it, but if it errors, recreate it with `provider = "postgresql"`.
