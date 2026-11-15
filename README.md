# tampermonkey

Riley's Tampermonkey userscripts.

- `claude-code-ui-tweaks.user.js`: UI changes for claude.ai/code.
- `github-timeline-tweaks.user.js`: GitHub timeline tweaks and Slack theme.
- `stubs/`: install these in Tampermonkey. Each stub loads its script from this repo with `@require`.

To get changes quickly, set Tampermonkey Settings > Config mode "Advanced" > Externals > Update interval to "Always". GitHub caches raw files for up to 5 minutes.

## Spike: PR reading order

`github-pr-reading-order.user.js` shows the changed files of a pull request in an order to read them: dependencies first, each test after its subject, then config, docs and generated files. Keys: `]` next file, `[` previous file. To try it, make a new Tampermonkey script with the header of that file and add this line to the header:

`// @require https://raw.githubusercontent.com/rileythomp/tampermonkey/pr-reading-order/github-pr-reading-order.user.js`
