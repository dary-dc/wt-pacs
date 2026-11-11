p='/home/user/proposals/lab/proposals/link_cells.mjs'
s=open(p).read()
def r(a,b):
    global s
    assert s.count(a)==1,a; s=s.replace(a,b)
r("(P1, P4, P5)","(P1, P3, P4, P5)")
r("[--host ROOT] [--cpu-throttle RATE]\n","[--host ROOT] [--cpu-throttle RATE]\n//        [--exact-only] [--lead-ms L]\n")
r("//   prints one JSON row","//     --exact-only: only the exact session through the relay, which --idle-promote needs; --lead-ms: ask by the\n//     button, its pointerdown L ms before its click (P3), instead of the `l` key\n//   prints one JSON row")
r('''writeFileSync(`${T}/transport.json`, transport.replace(":4433", ":5433"));''','''const exactOnly = process.argv.includes("--exact-only");
writeFileSync(`${T}/transport.json`, exactOnly ? transport : transport.replace(":4433", ":5433"));''')
r('''["lab/scripts/link_impair.py", "--udp", "5433:4433", "--udp", "5434:4434",''','''["lab/scripts/link_impair.py", ...(exactOnly ? [] : ["--udp", "5433:4433"]), "--udp", "5434:4434",''')
r('''link: arg("--link"),''','''link: arg("--link"), exactOnly, leadMs: arg("--lead-ms") === undefined ? null : Number(arg("--lead-ms")),''')
r('''    const pressed = await page.evaluate(() => performance.now());
    await page.keyboard.press("l");
''','''    if (row.leadMs !== null) {
      await page.dispatchEvent("#lossless", "pointerdown");
      await page.waitForTimeout(row.leadMs);
    }
    const pressed = await page.evaluate(() => performance.now());
    if (row.leadMs !== null) await page.dispatchEvent("#lossless", "click");
    else await page.keyboard.press("l");
''')
open(p,'w').write(s)
s=open(p).read()
a='''    row.shown = status(await log()).match(/^frame (\\d+)/)?.[1];
'''
assert s.count(a)==1
s=s.replace(a,a+'''    row.statusAfter = status(await log());
''')
open(p,'w').write(s)
