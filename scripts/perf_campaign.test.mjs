// node scripts/perf_campaign.test.mjs — what each arm of scripts/perf_nightly.mjs runs, and the value a round it judges.
import { arms, value } from "./perf_campaign.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const digests = ["d0", "d1"];

/** Without a view the three arms run the nightly's one variant on the harness's own page, as before the option. */
{
  const { names, variants } = arms(null, digests);
  check(new Set(Object.values(names)).size === 1 && JSON.stringify(variants[names.head]) === JSON.stringify({ digests }), "no view: not the nightly's variant");
  check(!variants[names.head].viewer, "no view: an arm on the viewer");
}

/** Under a view every arm opens the product's viewer, the head alone under that view: base and A/A stay one variant. */
{
  const { names, variants } = arms("worker", digests);
  for (const arm of ["base", "head", "aa"]) check(variants[names[arm]]?.viewer === "viewer.json" && variants[names[arm]].codec === "htj2k", `${arm}: not on the viewer`);
  check(variants[names.head].view === "worker", "head: not under ?view=worker");
  check(names.base === names.aa && variants[names.base].view === undefined, "base or A/A: under a view");
  check(variants[names.head].digests === digests && variants[names.base].digests === digests, "an arm without the series' digests");
}

/** A fill's visit gives its fill and first frame; an ask's the median of its asks; a VOID or inexact visit nothing. */
{
  const fill = { void: false, exact: 48, owed: 48, decodedMs: 900, firstMs: 120 };
  check(value(fill, "fill") === 900 && value(fill, "first") === 120 && value(fill, "asked") === null, "fill visit");
  const ask = { void: false, exact: 4, owed: 4, frames: 0, afterMs: [40, 10, 30, 20] };
  check(value(ask, "asked") === 25 && value(ask, "fill") === null, "ask visit");
  check(value({ ...fill, void: true }, "fill") === null, "a VOID visit counted");
  check(value({ ...ask, exact: 3 }, "asked") === null, "an inexact visit counted");
  check(value(undefined, "first") === null, "a missing visit counted");
}

if (failed) process.exit(1);
console.log("perf_campaign: ok");
