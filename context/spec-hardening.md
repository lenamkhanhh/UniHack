# Spec hardening after dec7648

Base: `dec7648d7bac11cee19632a1f5fe7a2b3b4ff6bf`. Date: 4 November 2026.
Scope: design/specification and handoff only. No app implementation, DB provisioning, contract deployment,
live payment, benchmark or runtime test was performed in this revision.

## Decisions closed

- Quote does not reserve budget or compute a paid upstream result. Reservation is required before agent signing.
- Unsigned reservation expires by lease; signing and lease expiry compete atomically. Signed exposure remains
  reserved until a finalized chain reconciliation permits terminal accounting.
- One immutable authorization per operation, global operationId primary key, unique authorization nonce binding,
  and unique session/minute constraint. Terminal transitions and audit append are serialized/idempotent.
- Settlement requires the correct token/chain/nonce and Transfer in a successful finalized transaction;
  Transfer amount alone and nonce bool are insufficient. Reverted tx alone does not invalidate the signature.
- Durable held result precedes settlement, durable submission intent precedes external call.
  UNKNOWN remains pending with budget reserved; no invented tx hash or unsafe force-release.
- Mission expiry/close/pause blocks new spend, while an owner can obtain read-only access to reconciliation/results.
- Owner challenge binds action/domain/deployment/stage/guard/authVersion/payload/nonce/expiry for all owner APIs.
  Cutover revokes S1 credentials by version and preserves historical operation exposure.
- Treasury request operationId is also enforced on-chain, so retries cannot create duplicate auto payouts.
- Guard auto payout happens in propose, owner execute is only for Approved; no treasury payout to mission.agent.
  Demo refills are explicit owner transfers outside guard; key-compromise tool loss is wallet balance plus refills.
- Concurrent audit append locks head, event ingestion has unique source keys, offline verifier consumes an export.
  Public evidence uses an allowlist of fields, not ORM dumps. Demo does not wipe accounting history.
- Wallet roles are explicit (O owner/client, A registry owner/proposer/payer, S seller). A paid call is not
  mission completion; O confirms deliverable before quality feedback, one feedback per mission in the app.
- S1 fallback, stage gates, constants, demo, test IDs and handoff agree. File 10 is historical; no later-file-wins rule.

## Implementation acceptance

See [06](../pipeline/06-tests-security.md) for C/P/V/E/L requirements. They are not marked passed.
Check the deployed USDC and registry ABIs/code, SDK versions, facilitator settlement, Fuji finality support,
database migrations and every runtime behavior when implementing. Candidate addresses are not deployment evidence.

## Primary sources consulted

- [x402 v1 specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md)
- [Circle ERC-3009 implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol)
- [ERC-8004 draft](https://eips.ethereum.org/EIPS/eip-8004)
- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)

## Checks actually executed

- Markdown consistency: 19 Markdown files, 29 local links, 2 JSON examples, 25 tables; no errors after fixing
  table column counts. Historical review-response snippets are excluded from the current table-format check.
- Acceptance/schema consistency: 71 unique C/P/V/E IDs, required global operation primary key, tick/nonce unique
  constraints and recovery/auth/completion fields present in the schema sketch. This is text validation, not Prisma validation.
- Git whitespace check passed; ignore rules cover env/private evidence/broadcast while allowing .env.example.
- Read-only remote HEAD checked against base before commit. No application, contract, database or live smoke test run.

## Command record

Commands run from the scoped UniHack checkout unless an explicit file path is shown:

- git status --short -- .; git log -1 --format='%H %s'; git remote -v; rg --files -g AGENTS.md .
- git fetch origin main; git merge --ff-only origin/main (fast-forward from the stale local research commit).
- Get-Content for the applicable AIO Code AGENTS.md, existing pipeline/context/README, and the writing-style skill
  under the user-supplied skill root; Test-Path for the explicit applicable instruction paths.
- python --version; git config user.name; git config user.email (read-only identity check; private values not recorded here).
- Scoped Get-Content/Select-Object and rg consistency searches over the edited files.
- git diff --check -- .; git diff --stat -- .; git diff --numstat -- .; git diff -- pipeline/01-contracts.md.
- Inline Python Markdown/link/JSON/table/schema/acceptance checks using pathlib/re/json and subprocess;
  subprocess ran git check-ignore --no-index -q for env/private-evidence/broadcast fixtures and .env.example,
  and `git diff --check -- .`. Fixtures are path strings; no secret files or app test fixtures were created.
- git ls-remote --heads origin main; git add -- .; git diff --cached --check -- .;
  git diff --cached --name-only -- .; git diff --cached --stat -- .
- git -c user.name='Nam Khanh Le' -c user.email='<GitHub noreply identity>' commit -m 'Harden UniHack execution spec and Gemini handoff';
  git push origin main; git log -1 --format='%H %s'; remote SHA/tree verification via gh api.

Primary-source pages were also read through the web tool; file edits used apply_patch. No reset --hard,
force push, package installation, app build, database provisioning or deployment was used.
Runtime claims require future C/P/V/E/L executions and actual receipts.
