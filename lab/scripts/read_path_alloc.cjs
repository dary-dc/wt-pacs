// What a read path allocates over one fill. Counts, not timing.
// --js-flags=--trace-gc emits nothing in this Chromium build, so the instruments are CDP:
// HeapProfiler sampling for bytes allocated, the v8.gc trace category for collections.
const { chromium } = require('playwright');

const arm = process.argv[2];
const frames = process.argv[3] || '237';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
    args: ['--disable-background-networking', '--disable-component-update', '--enable-precise-memory-info'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const cdp = await page.context().newCDPSession(page);

  const gcEvents = [];
  cdp.on('Tracing.dataCollected', (d) => {
    for (const e of d.value || []) if (/^V8\.GC/.test(e.name || '')) gcEvents.push(e.name);
  });

  await page.goto('about:blank');
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
  await cdp.send('Tracing.start', {
    categories: 'disabled-by-default-v8.gc,v8',
    transferMode: 'ReportEvents',
  });

  await page.goto(`http://127.0.0.1:8765/harness/byob-alloc.html?arm=${arm}&frames=${frames}`);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 300000 });
  const res = await page.evaluate(() => globalThis.__wtpacsResult);

  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;
  const prof = await cdp.send('HeapProfiler.getSamplingProfile');

  const total = (function sum(n) {
    return (n.selfSize || 0) + (n.children || []).reduce((a, c) => a + sum(c), 0);
  })(prof.profile.head);

  await browser.close();
  console.log(JSON.stringify({
    arm,
    frames: res.got,
    codestreamMB: +(res.bytes / 1048576).toFixed(1),
    allocatedMB: +(total / 1048576).toFixed(1),
    heapPeakMB: +(res.peak / 1048576).toFixed(1),
    heapAfterMB: +(res.after / 1048576).toFixed(1),
    gcs: gcEvents.length,
  }));
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
