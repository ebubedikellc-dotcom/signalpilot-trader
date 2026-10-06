# Pinned FnZero builders

Source: https://github.com/0xfnzero/sol-trade-sdk-nodejs
Commit: `287dd67bd37b6e3084b253674c58cf1b9dbe3f34` (package version 0.1.7).
Upstream package.json declares MIT. The accompanying MIT license notice is from
the parent FnZero Rust SDK, https://github.com/0xfnzero/sol-trade-sdk/blob/main/LICENSE.

`builders.mjs` is an unminified, tree-shaken bundle of this entry point:

```ts
export { AccountCacheSnapshot, PoolTradeHint } from './src/trading/subscription_cache';
```

Rebuild from the pinned checkout with esbuild 0.28.1:

```
esbuild signalpilot-entry.ts --bundle --platform=node --format=esm --external:@solana/web3.js --outfile=builders.mjs
```

Only account decoding, quoting and instruction construction are included. No
FnZero provider, wallet, private-key, signing or submission implementation is
loaded. The generated bundle has no fetch, environment access or filesystem IO.
Existing @solana/web3.js supplies Solana primitives. No runtime dependency or
installation script was added.

`tests/fixtures/fnzero-cpmm.json` is the upstream **synthetic** `tests/batch2_cpmm.json`
fixture from the same commit. Fixture tests are not live speed benchmarks.
