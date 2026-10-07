/** What the browser rigs share: the fake's certificate, a bounded wait, a bounded start, and the page's tally. */
import type { Check } from "./clauses.ts";

export const CERT = "ab".repeat(32);

export const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** True once `cond` holds, false if `ms` pass first; a condition that reads a worker's fake is async. */
export async function until(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (!(await cond()) && Date.now() - t0 < ms) await settle(10);
  return cond();
}

/** A downloader that never starts fails its clause by name instead of hanging the page. */
export function started<T>(connect: Promise<T>): Promise<T> {
  return Promise.race([
    connect,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the downloader did not start in 5 s")), 5000)),
  ]);
}

/** Runs `body` with a check that logs each failure, then publishes the count drive_page.cjs exits with. */
export async function tally(log: (line: string) => void, name: string, summary: string, body: (check: Check) => Promise<void>) {
  let failed = 0;
  let ran = 0;
  const check: Check = (cond, what) => {
    ran += 1;
    if (!cond) {
      failed += 1;
      log(`  FAIL: ${what}`);
    }
  };
  log(name);
  try {
    await body(check);
  } catch (e) {
    failed += 1;
    log(`  FAIL: ${name} threw: ${(e as Error)?.message ?? e}`);
  }
  log(`\n${summary}: ${ran - failed}/${ran} checks passed through the downloader`);
  (globalThis as Record<string, unknown>).__wtpacsFailed = failed;
  (globalThis as Record<string, unknown>).__wtpacsDone = true;
}
