// The census is a guard, so what matters is that it fires on the shapes
// of failure this project has actually seen — and stays quiet on the
// normal case, since a guard that cries wolf gets bypassed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shrinkages, takeCensus } from "./scrape-census";

interface Row {
  role: string;
  type: string;
}

const byRoleAndType = (r: Row) => [`role:${r.role}`, `type:${r.type}`];
const rows = (spec: Record<string, number>): Row[] =>
  Object.entries(spec).flatMap(([key, n]) => {
    const [role, type] = key.split("/");
    return Array.from({ length: n }, () => ({ role, type }));
  });

test("a category emptying out is caught even when the total holds", () => {
  // The Fog Vial bug in miniature: Firecrackers dropped, Fog Vials added
  // in their place. The total is identical, so the only thing that could
  // have caught it is the per-category count.
  const before = takeCensus(rows({ "survivor/firecracker": 6, "survivor/flashlight": 12 }), byRoleAndType);
  const after = takeCensus(rows({ "survivor/fog-vial": 6, "survivor/flashlight": 12 }), byRoleAndType);
  assert.equal(before.total, after.total, "the totals should match — that's the whole point");
  assert.deepEqual(shrinkages(before, after), [
    { category: "type:firecracker", before: 6, after: 0 },
  ]);
});

test("a category that vanishes reads as a drop to zero, not as absent", () => {
  const before = takeCensus(rows({ "killer/hex": 3 }), byRoleAndType);
  const after = takeCensus([], byRoleAndType);
  const lost = shrinkages(before, after);
  assert.deepEqual(
    lost.map((c) => c.category).sort(),
    ["role:killer", "total", "type:hex"],
  );
  assert.ok(lost.every((c) => c.after === 0));
});

test("growth is never flagged", () => {
  // A chapter release adds a killer and their add-ons. If that tripped the
  // guard, the nightly scrape would fail every few weeks and get disabled.
  const before = takeCensus(rows({ "killer/power": 20 }), byRoleAndType);
  const after = takeCensus(rows({ "killer/power": 40, "survivor/medkit": 5 }), byRoleAndType);
  assert.deepEqual(shrinkages(before, after), []);
});

test("the emptied category is reported before the aggregates it drags down", () => {
  // The message is read top-down when a nightly scrape fails, so the first
  // line has to be the finding rather than its shadow. `total` and the
  // role bucket contain everything, so they always shed the most *rows* —
  // ranking by rows lost would bury the category that actually emptied.
  const before = takeCensus(rows({ "survivor/map": 30, "survivor/key": 8, "survivor/toolbox": 20 }), byRoleAndType);
  const after = takeCensus(rows({ "survivor/map": 29, "survivor/key": 0, "survivor/toolbox": 5 }), byRoleAndType);
  assert.deepEqual(
    shrinkages(before, after).map((c) => c.category),
    ["type:key", "type:toolbox", "total", "role:survivor", "type:map"],
  );
});

test("an unchanged scrape is silent", () => {
  const only = rows({ "survivor/medkit": 4, "killer/power": 9 });
  assert.deepEqual(shrinkages(takeCensus(only, byRoleAndType), takeCensus(only, byRoleAndType)), []);
});
