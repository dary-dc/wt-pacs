state: started
started: 2026-11-15T05:17Z
heartbeat: 2026-11-15T05:31Z
outputs: claude/report-plan (docs/client/evidence/report-plan.md §Protocol)
## Resume
Lever checks so far (scratch scripts, not pushed; findings to go in §7.6): Chromium 153.0.8010.12 (Playwright's
chromium-1243). Playwright's page stays visible under minimize and tab switch, and its bfcache never engages; a raw
CDP drive (chrome --headless=new, Target.createTarget, Browser.setWindowBounds minimized / Target.activateTarget of
a second tab) hides it (visibilitychange hidden fires), and back/forward gives pagehide persisted, freeze, pageshow
persisted. Page.crash kills the renderer (visible or hidden); SIGKILL of the browser works; Page.setWebLifecycleState
frozen fires freeze. Relay --tun blackout drops kernel TCP too (curl 200 / 000 during 3 s / 200), and Chromium runs
inside its namespace (unshare -rn; iproute2 installed). The TCP plane without --tun has no blackout.
Firefox 159.0 (archive tarball) over raw BiDi, headless: navigate, bfcache (traverseHistory), hide by a second tab activated work; closing the last tab sends nothing, closing with another tab open fires pagehide+hidden; about:crashcontent from BiDi does not crash. WebKitGTK 2.52.6 (apt webkit2gtk-driver, MiniBrowser --automation under xvfb-run; --headless hangs session creation): navigate, back (bfcache), minimize (hidden), close-with-other work; a new tab is a window there, so no hide. Content-process kills on Firefox/WebKit not checked. Next: write §7 Protocol in report-plan.md, then phone asks.
## Result
