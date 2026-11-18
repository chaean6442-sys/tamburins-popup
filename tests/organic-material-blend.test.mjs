import assert from "node:assert/strict";
import test from "node:test";
import { balancedMaterialSplit, organicMaterialField } from "../app/logic/organicMaterialBlend.ts";

test("two materials form balanced patches across a sphere", () => {
  const fields = [];
  for (let latitude = 1; latitude < 48; latitude += 1) {
    const phi = latitude / 48 * Math.PI;
    for (let longitude = 0; longitude < 96; longitude += 1) {
      const theta = longitude / 96 * Math.PI * 2;
      fields.push(organicMaterialField(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ));
    }
  }
  const split = balancedMaterialSplit(fields);
  const firstShare = fields.filter((value) => value <= split).length / fields.length;
  assert.ok(firstShare > 0.49 && firstShare < 0.51);
  // The mask varies around a latitude rather than repeating a straight band.
  const equator = fields.slice(23 * 96, 24 * 96).map((value) => value > split);
  assert.ok(equator.some(Boolean) && equator.some((value) => !value));
});
