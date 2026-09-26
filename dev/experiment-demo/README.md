# Experiment demo

A pricing page wired up with the experiment wizard's snippets, and a traffic
simulator with known conversion rates, to check an experiment's results against
the truth.

## Run it

With the dev stack running (see `plans/ab-testing.md`):

1. Create an experiment in the dashboard with the default `control` / `variant_a`
   split and an event goal, e.g. `signup_clicked`.
2. Serve the page with the flag key the wizard shows:

   ```sh
   node dev/experiment-demo/serve.mjs --site 2 --flag pricing_headline --goal signup_clicked
   ```

3. Start the experiment, then send visitors:

   ```sh
   node dev/experiment-demo/simulate.mjs --visitors 1600 --rates control=0.10,variant_a=0.14
   ```

The simulator prints the true and observed rate per variant; compare them with
the experiment's results panel. Use equal rates (`control=0.1,variant_a=0.1`)
for an A/A test, which should not declare a winner.

## Notes

- Each visitor is a fresh headless Chrome profile behind its own `x-forwarded-for`
  IP, so the analytics server sees distinct visitors. `--later 0.3` makes 30% of
  conversions happen on a return visit from another IP: a new session for the
  same visitor, which should still count.
- The site needs **Block bots** turned off in Site settings; headless Chrome is
  detected as a bot otherwise.
- `--seed` repeats a run's visitors. Visitors are drawn in the same order, but
  their flag assignment depends on the visitor id the script generates.
- The simulator uses puppeteer from `server/node_modules`; run `pnpm install`
  at the root first.
- The page loads the wizard snippet as a module. The install tag is `defer`, so a
  plain inline `<script>` would run before `window.rybbit` exists.
