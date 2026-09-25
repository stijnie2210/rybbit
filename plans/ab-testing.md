# A/B testing (Experiments) in the Rybbit fork

## Context
The goal is PostHog/GrowthBook-style A/B testing. The choices so far are: a JS API in the tracking script, an experiments MVP, Bayesian stats, and changes kept in this fork only.

**Most of the MVP is already in the codebase.** Upstream has built it but hidden it in the UI. The Feature Flags and Experiments sidebar items are commented out in `client/src/app/[site]/components/Sidebar/Sidebar.tsx:164-179`. Everything behind that is already built:
- **Flags:** feature flags (boolean, multivariate, remote config) with deterministic sha256 bucketing (`server/src/services/featureFlags/evaluator.ts`), rollout percentages, targeting rules and condition sets.
- **Tracking script API:** `rybbit.flag(key, fallback)`, `flagPayload`, `flags()` and `onReady`. The first `flag()` call fires a deduplicated `feature_flag_exposure` event (`server/src/analytics-script/tracking.ts:251-270`). Every event carries a `feature_flags` map that lands in ClickHouse as the `events.feature_flags` column.
- **Data model:** an `experiments` Postgres table (`server/src/db/postgres/schema.ts:739`) linking a multivariate flag to a primary goal, with a draft/running/paused/completed status.
- **Server:** CRUD plus a results endpoint (`server/src/api/experiments/*`, routes at `server/src/index.ts:511-515`).
- **UI:** a creation wizard, a list page and a results panel (`client/src/app/[site]/experiments/*`).

So the plan is to **turn on and harden** what exists rather than build from scratch. These gaps stop it from being trustworthy:
1. **The unit of analysis is the session.** Results group by `session_id`, and a session ends after 30 minutes of inactivity. A returning visitor counts as several "users" in the same arm, and a conversion in a later session is missed. Bucketing already uses a stable localStorage `visitor-id`, but that id never reaches ClickHouse.
2. **The stats are frequentist.** A pooled two-proportion z-test on the client (`experiments/lib/experimentHelpers.ts:78-124`) shows only "confidence", with no interval and no untested code path.
3. **The analysis window isn't tied to the experiment.** Results use the page's date filter instead of `startedAt`/`endedAt`.
4. **There's no sample-ratio-mismatch (SRM) check**, which would catch broken assignment.

## Phase 0: Turn it on and smoke-test (small)
- Uncomment both sidebar items in `Sidebar.tsx`. `Flag` and `FlaskConical` may need re-importing.
- Run `pnpm dev`. Create a multivariate flag (`control`/`test` at 50/50), a goal and an experiment. On a test HTML page, add the script plus `rybbit.onReady(() => rybbit.flag('my-exp'))` and fire the goal. Confirm the results panel fills in.
- Write down any bugs found here before moving on. Upstream hid the feature for a reason, and this step shows what that reason was.

## Phase 1: Per-visitor analysis unit
- **ClickHouse:** add `visitor_id String DEFAULT ''` to `EVENTS_COLUMNS_TO_ENSURE` and to the `events` DDL in `server/src/db/clickhouse/schema/core.ts`. This is applied automatically at startup, and there's no migration file for ClickHouse.
- **Payload:** add an optional `visitor_id` (uuid-ish, max 64 characters) to the base schema in `server/src/services/tracker/trackingPayload.ts`. Pass it through `createBasePayload` (`services/tracker/utils.ts`) and map it in `pageviewQueue.ts`.
- **Tracking script:** in `createBasePayload` (`tracking.ts:~189`), send `config.visitorId` **only when `featureFlagsEnabled`**. Sites without flags stay cookieless as they are today, and it stays separate from `anonymous_id`, so unique-user counts don't change.
- **Results query** (`getExperimentResults.ts`):
  - Group exposures by `unit = if(visitor_id != '', visitor_id, session_id)`, with the variant set by the first exposure (`argMin`).
  - Join goals on the same unit, keeping `goal_at >= exposed_at`.
  - Return `units` as the denominator. Keep `sessions` for display.
- **Tests:** extend `getExperimentResults.test.ts` so it asserts the unit expression and the cross-session conversion.

## Phase 2: Bayesian stats
- New `shared/src/experimentStats.ts` (shared, so it's testable and could also run on the server):
  - Beta(1,1) prior, so each arm's posterior is Beta(1+conversions, 1+units−conversions).
  - `chanceToBeatControl`: a normal approximation of the Beta posteriors for large n. For small n, use Monte Carlo with a seeded PRNG and about 20k draws.
  - Relative lift with a 95% credible interval, and **expected loss** per arm (risk of choosing it).
  - Decision rule: chance to beat control ≥ 95% and expected loss below a small threshold means "winner". Otherwise, "keep running".
- Swap the z-test in `experimentHelpers.ts` and `ExperimentResultsPanel.tsx` for: chance to beat control, lift with credible interval (a small interval bar), and the expected loss / decision badge.
- `shared/src/experimentStats.test.ts` runs Vitest with known reference values, for example against GrowthBook's documented examples.

## Phase 3: Trust and usability
- **Experiment window:** when an experiment has `startedAt`, the results default to `[startedAt, endedAt ?? now]`. It stays overridable.
- **SRM check:** run a chi-square test of the observed units per arm against the flag's configured split. Show a warning banner at p < 0.001.
- **Conversion over time:** a daily cumulative conversion-rate line per variant (Nivo, like the goals charts), from a new `/:experimentId/timeseries` endpoint that reuses the same CTEs.
- **Wizard copy:** show the exact snippet in the flag and experiment wizard, e.g. `rybbit.onReady(() => { if (rybbit.flag('key') === 'test') … })`.

## Out of scope for now
No-code/visual editor, a server-side SDK (the authenticated evaluate endpoint already exists and can come later), multiple or secondary metrics, guardrails, and revenue metrics.

## Critical files
- `client/src/app/[site]/components/Sidebar/Sidebar.tsx`
- `server/src/analytics-script/{tracking.ts,config.ts}`
- `server/src/services/tracker/{trackingPayload.ts,utils.ts,pageviewQueue.ts}`
- `server/src/db/clickhouse/schema/core.ts`
- `server/src/api/experiments/{getExperimentResults.ts,utils.ts,types.ts}` (+ test)
- `shared/src/experimentStats.ts` (new)
- `client/src/app/[site]/experiments/{lib/experimentHelpers.ts,components/ExperimentResultsPanel.tsx}`

## Verification
- `pnpm typecheck` and `pnpm test`, including the new stats tests and the extended results-query test.
- Manual end to end with `pnpm dev`: a test page with the script, flag and goal. Open it in two browser profiles, confirm each keeps its variant across reloads and across a >30-minute gap (or clear the Redis session), and check that a conversion in the second session is counted.
- Query ClickHouse directly: `SELECT visitor_id, feature_flags, event_name FROM events WHERE site_id=… ORDER BY timestamp DESC LIMIT 20`.
- Deploy only when happy: `docker compose up -d --build` in the repo (rebuilds `rybbit-*:local`). The new ClickHouse column is added on backend startup. Postgres needs no migration, because the `experiments` and `feature_flags` tables already exist (drizzle `0006`).

## Status (2026-09-25)
Done:
- Phase 0: Feature Flags + Experiments sidebar items re-enabled; `Feature Flags` / `Experiments` message keys added for all locales.
- `pnpm typecheck` passes; existing experiment + feature-flag tests pass (56/56).
- Dev databases: `dev/docker-compose.yml` (project `rybbit-dev`, ports 15432 / 18123 / 16379).

- Phase 0 smoke test (2026-09-25): the wizard (new flag + new event goal), start/pause/complete, flag evaluation, exposure + goal events, and the results panel all work end to end. With 12 distinct visitors, results matched ClickHouse exactly (control 7/5, variant_a 5/3), and every visitor kept its variant across reloads.

Phase 0 findings:
1. **Visitors sharing IP + normalised UA merge into one session and user.** Browser version tokens are stripped before hashing (`userIdService.generateUserId`). All 12 visitors from one IP became a single session covering both variants, and results attributed everything to the first-exposed variant (control 1/1, variant_a 0/0). That's realistic behind an office NAT or carrier CGNAT. It raises the priority of Phase 1 (`visitor_id` as the unit).
2. **Pause and Complete don't touch the flag.** The flag stays enabled and keeps assigning. Results use the page date filter, so a completed experiment keeps collecting (12 → 15 sessions after Complete). Fold this into the Phase 3 experiment window. Also decide whether Complete should roll out the winner or disable the flag.
3. **The wizard's flag key field eats separators while you type.** `slugify` runs on every keystroke and trims trailing `_`, so typing `smoke_exp` gives `smokeexp`. Only pasting a whole key works. Fix: slugify on blur/submit only, or keep trailing `_` while editing.
4. **Minor: `exposures` counts events, not units.** It's 2 per visitor with a reload. The results panel shows sessions, so it's harmless for now.
5. Not experiment bugs, but noise in the self-hosted dev console: hydration mismatch warnings, and a Stripe `IntegrationError` about an empty publishable key.

Testing notes: headless Chrome gets blocked by `blockBots` (client signals), so turn it off on the test site. To simulate distinct visitors, give each browser context its own `x-forwarded-for`, injected via request interception (setting it as a page header triggers a failing CORS preflight).

- Phase 1 (2026-09-25): the script sends `visitor_id` when flags are enabled, it's stored in `events.visitor_id`, and results group by `if(visitor_id != '', visitor_id, session_id)`. The response adds `units` / `totalUnits` (the denominator). `sessions` is now a distinct count per variant. The panel shows "visitors". Verified end to end: 8 visitors behind one IP + UA became 8 units (they had merged into 1 in Phase 0), and 4 visitors exposed in session 1 who converted in session 2 all counted. Results were variant_a 8/5 and control 4/3, both exactly as expected.
- `src/lib/oauth.test.ts` fails 2 tests (invalid_grant, OTP_EXPIRED) on a clean tree too. It predates this work.

Not yet done: Phases 2–3.

## Dev setup on a new machine
1. Node >= 22.13 (24 recommended), `corepack enable`, `pnpm install`.
2. `docker compose -f dev/docker-compose.yml up -d`
3. `server/.env` (gitignored):
   ```
   NODE_ENV=development
   BASE_URL=http://localhost:3002
   CLICKHOUSE_HOST=http://localhost:18123
   CLICKHOUSE_DB=analytics
   CLICKHOUSE_USER=default
   CLICKHOUSE_PASSWORD=dev
   POSTGRES_HOST=localhost
   POSTGRES_PORT=15432
   POSTGRES_DB=analytics
   POSTGRES_USER=dev
   POSTGRES_PASSWORD=dev
   REDIS_HOST=localhost
   REDIS_PORT=16379
   REDIS_PASSWORD=dev
   BETTER_AUTH_SECRET=<openssl rand -hex 32>
   ```
4. `client/.env.local`: `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`
5. `cd server && pnpm db:migrate` (dev DB only), then `pnpm dev` from the root.

Gotchas:
- Ports 3001/3002 must be free. On the home Mac the live rybbit `backend`/`client` containers publish `127.0.0.1:3001/3002` and shadow the dev servers.
- Running `pnpm dev` makes next-intl re-extract `client/messages/*.json` and reorder every key. Don't commit that churn. Only add new keys.
