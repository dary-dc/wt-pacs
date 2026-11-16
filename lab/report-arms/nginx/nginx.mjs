// The receivers' nginx (report-plan.md §3.5 as advocated): NGINX writes each record as its access line, by early
// read (nginx ≥ 1.31.5); in front of RECEIVER it proxies, logging the body only when the answer is not 2xx.
// The rig's pages are proxied to the sink, so every carrier stays same-origin. NGINX_BIN=<binary> overrides `nginx`.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LINE = `'{"t":"$time_iso8601","s":"$status","n":"$content_length","r":"$request_body"}'`;

// `try_files … =204`, not `return 204`: `return` answers in the rewrite phase, before limit_req's (nginx.test.mjs).
/** `receiver` is "nginx" (the arm NGINX) or a port: nginx in front of RECEIVER there. */
export function conf({ dir, port, pages, receiver }) {
  const report = receiver === "nginx" ? `
    client_body_early_read $report_early;
    location = /report/load {
      limit_except POST { deny all; }
      limit_req zone=report burst=20 nodelay;
      limit_req_status 429;
      root ${dir};
      access_log ${dir}/load-$report_day.jsonl report;
      try_files /.none =204;
    }
    location = /report/safety {
      limit_except POST { deny all; }
      root ${dir};
      access_log ${dir}/safety-$report_day.jsonl report;
      try_files /.none =204;
    }` : `
    location /report/ {
      proxy_pass http://127.0.0.1:${receiver};
      proxy_http_version 1.1;
      access_log ${dir}/report-fallback.log report if=$loggable;
    }`;
  return `worker_processes 1;
daemon off;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events {}
http {
  client_body_temp_path ${dir}/tmp/body;
  proxy_temp_path ${dir}/tmp/proxy;
  fastcgi_temp_path ${dir}/tmp/fastcgi;
  uwsgi_temp_path ${dir}/tmp/uwsgi;
  scgi_temp_path ${dir}/tmp/scgi;
  access_log off;
  log_format report escape=json ${LINE};
  map $time_iso8601 $report_day { "~^(?<day>\\d{4}-\\d{2}-\\d{2})" $day; }
  map "$request_method $uri" $report_early { "POST /report/load" 1; "POST /report/safety" 1; }
  map $status $loggable { ~^[23] 0; default 1; }
  limit_req_zone $binary_remote_addr zone=report:1m rate=10r/s;
  server {
    listen 127.0.0.1:${port};
    client_max_body_size 16k;
    client_body_buffer_size 16k;
    client_body_in_single_buffer on;
    ${report}
    location / { proxy_pass http://127.0.0.1:${pages}; }
  }
}
`;
}

export async function startNginx({ dir, port, pages, receiver }) {
  mkdirSync(join(dir, "tmp"), { recursive: true });
  chmodSync(dir, 0o777); // a variable log path is opened by the worker, which drops root's rights
  const file = join(dir, "nginx.conf");
  writeFileSync(file, conf({ dir, port, pages, receiver }));
  // nginx reads NGINX from its environment as inherited sockets.
  const { NGINX: _, ...env } = process.env;
  const nginx = spawn(process.env.NGINX_BIN ?? "nginx", ["-p", dir, "-c", file, "-e", join(dir, "error.log")],
    { env: { ...env, TZ: "UTC" }, stdio: "ignore" });
  const exited = new Promise((ok) => nginx.on("exit", ok));
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" }).then(() => true, () => false)) {
      return { port, close: async () => { nginx.kill(); await exited; } };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  nginx.kill();
  const log = existsSync(join(dir, "error.log")) ? readFileSync(join(dir, "error.log"), "utf8") : "";
  throw new Error(`nginx did not start: ${log}`);
}

/** NGINX's sink counters, read from its files: its 204 precedes the line, so appended and acknowledged are one count. */
export function nginxCounters(dir) {
  const c = { received: 0, appended: 0, acknowledged: 0, duplicates: 0, byKind: { load: 0, safety: 0 },
              refused: { notObject: 0, tooLarge: 0, path: 0, method: 0, rate: 0 } };
  const seen = new Set();
  for (const f of readdirSync(dir).filter((f) => /^(load|safety)-.*\.jsonl$/.test(f))) {
    const kind = f.split("-")[0];
    for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
      const { s, r } = JSON.parse(line);
      c.received++;
      if (s === "403") { c.refused.method++; continue; }
      if (s === "429") { c.refused.rate++; continue; }
      c.appended++;
      c.acknowledged++;
      let o = null;
      try { o = JSON.parse(r); } catch {}
      if (o === null || typeof o !== "object" || Array.isArray(o)) { c.refused.notObject++; continue; }
      c.byKind[kind]++;
      if (o.reportId != null) seen.has(o.reportId) ? c.duplicates++ : seen.add(o.reportId);
    }
  }
  const errors = existsSync(join(dir, "error.log")) ? readFileSync(join(dir, "error.log"), "utf8") : "";
  c.refused.tooLarge = errors.split("client intended to send too large body").length - 1;
  c.received += c.refused.tooLarge;
  return c;
}
