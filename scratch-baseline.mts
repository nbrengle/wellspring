import ARCH from "./src/data/archetypes.json" with { type: "json" };
import { validate } from "./src/engine/validate.js";
const snap: any = {};
for (const a of ARCH as any[]) {
  let r: any;
  try {
    r = validate({ ...a, archetypeName: a.name });
  } catch (e) {
    snap[a.name] = "ERR:" + (e as any).message;
    continue;
  }
  snap[a.name] = {
    prereqIssues: (r.prereqs?.issues || []).map((i: any) => `${i.item}:${i.text}`).sort(),
    bestowed: (r.bestowedAbilities?.list || [])
      .map((g: any) => `${g.abilityType}:${g.abilityName}<-${g.source}`)
      .sort(),
    valid: r.valid,
  };
}
console.log(JSON.stringify(snap));
