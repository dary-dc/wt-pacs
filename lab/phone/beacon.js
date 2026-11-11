/** The phone run's switch for the product's load report: every load drawn, sent to dev-server.py's sink, the run's fields added. lab/phone/README.md */

export const BEACON_PATH = "/lab/beacon";

/** viewer.js's lab hook for `?beacon=<controller>`; `report` is the page's once the viewer hands it over. */
export function beaconHooks(q, fields = {}) {
  const hooks = {
    telemetry: { rate: 1, url: BEACON_PATH, fields: { controller: q.get("beacon"), port: location.port, ...fields } },
    report: null,
    reported(r) {
      hooks.report = r;
      const consoleError = console.error;
      console.error = (...a) => (r.error("console.error", a.map(String).join(" ")), consoleError.apply(console, a));
    },
  };
  return hooks;
}
