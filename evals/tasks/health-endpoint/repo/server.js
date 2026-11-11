const http = require("node:http");

const server = http.createServer((req, res) => {
  if (req.url === "/hello") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("hello");
  }
  res.writeHead(404);
  res.end();
});

if (require.main === module) server.listen(3000);
module.exports = { server };
