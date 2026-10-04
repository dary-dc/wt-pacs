// node client/downloader/downloader.test.mjs — how many decoders a start makes, without a browser.
globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
globalThis.postMessage = () => {};
let made = 0;
globalThis.Worker = class {
  constructor() {
    made++;
  }
  postMessage() {}
};

/** A fresh downloader on a host reporting `cores`, started with no `decoders`: the workers it makes. */
async function decodersOn(cores) {
  Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: cores }, configurable: true });
  made = 0;
  await import(`./downloader.js?cores=${cores}`);
  onmessage({ data: { kind: "start", config: {} } });
  return made;
}

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};

// Two cores get two decoders: a third is no faster there and starves the page's main thread.
const two = await decodersOn(2);
check(two === 2, `2 cores: ${two} decoders, not 2`);
// Eight cores get three: the count is capped, not the core count.
const eight = await decodersOn(8);
check(eight === 3, `8 cores: ${eight} decoders, not 3`);
// A host that does not report its cores gets three.
const unknown = await decodersOn(undefined);
check(unknown === 3, `unreported cores: ${unknown} decoders, not 3`);

console.log(failed ? `${failed} failed` : "downloader decoder count: ok");
process.exit(failed ? 1 : 0);
