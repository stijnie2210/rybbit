import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4400" },
    host: { type: "string", default: "http://localhost:3001" },
    site: { type: "string" },
    flag: { type: "string" },
    goal: { type: "string", default: "signup_clicked" },
  },
});

if (!values.site || !values.flag) {
  console.error("Usage: node serve.mjs --site <siteId> --flag <flagKey> [--goal <event>] [--host <url>] [--port <n>]");
  process.exit(1);
}

const page = readFileSync(new URL("./index.html", import.meta.url), "utf8")
  .replaceAll("__RYBBIT_HOST__", values.host)
  .replaceAll("__SITE_ID__", values.site)
  .replaceAll("__FLAG_KEY__", values.flag)
  .replaceAll("__GOAL_EVENT__", values.goal);

createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(page);
}).listen(Number(values.port), () => {
  console.log(`Demo on http://localhost:${values.port} (site ${values.site}, flag ${values.flag}, goal ${values.goal})`);
});
