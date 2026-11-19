#!/usr/bin/env node
'use strict';
// Bundles Retell's browser SDK into one self-hosted file (public/vendor/retell-web.js),
// so the dashboard loads no third-party scripts. Re-run after upgrading retell-client-js-sdk.
require('esbuild')
  .build({
    stdin: { contents: "export { RetellWebClient } from 'retell-client-js-sdk';", resolveDir: __dirname + '/..' },
    bundle: true,
    format: 'iife',
    globalName: 'RetellSDK',
    minify: true,
    target: ['es2019'],
    outfile: __dirname + '/../public/vendor/retell-web.js',
    legalComments: 'none',
  })
  .then(() => console.log('Built public/vendor/retell-web.js'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
