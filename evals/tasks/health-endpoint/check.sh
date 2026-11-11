#!/usr/bin/env bash
set -euo pipefail
node --test
node -e '
const { server } = require("./server.js");
server.listen(0, async () => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  const ok = r.status === 200 && (await r.json()).ok === true;
  server.close();
  process.exit(ok ? 0 : 1);
});'
