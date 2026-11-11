const { test } = require("node:test");
const assert = require("node:assert");
const { server } = require("./server.js");

test("GET /hello", async () => {
  await new Promise((r) => server.listen(0, r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/hello`);
  assert.equal(await res.text(), "hello");
  server.close();
});
