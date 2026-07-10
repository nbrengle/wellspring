// param-domain.test.mjs — the dedupe/identity derivation. paramKind (pool|distinct)
// and pool size are DERIVED from prose; reusable = pool && cap > size. Verifies the
// derivation reproduces every hand-derived ruling. See DEDUPE_IDENTITY_PLAN.md.
import { test, eq, ok } from "./harness.mjs";
import { lookupEntity } from "../../src/engine/data.js";
import { paramInfo, paramReusable, paramIsIdentity, unresolvedParamDomains } from "../../src/engine/param-domain.js";
import skillsJson from "../../src/data/skills.json" with { type: "json" };
import perksJson from "../../src/data/perks.json" with { type: "json" };
import classesJson from "../../src/data/classes.json" with { type: "json" };

const find = (id) => lookupEntity(id);

// [entityId, expected reusable?] — reusable === param-is-payload (pool, cap>size);
// !reusable === param-is-identity (distinct, or pool with cap<=size).
const CASES = [
  ["skills:Extended Capacity - Novice", true], // pool Sphere=2, cap 4 > 2
  ["skills:Extended Capacity - Adept", true], // pool, cap 4 > 2
  ["skills:Extended Capacity - Greater", true], // pool, cap 3 > 2
  ["skills:Lore", false], // distinct (open)
  ["skills:Chronic Hobbyist", false], // distinct (open profession)
  ["perks:Elemental Affinity", false], // pool Element=4, cap 2 <= 4
];

test("param-domain: derived reusable matches rulings", () => {
  for (const [id, expected] of CASES) {
    const e = find(id);
    ok(e, `entity exists: ${id}`);
    eq(paramReusable(e, id), expected, `${id} reusable`);
    eq(paramIsIdentity(e, id), !expected, `${id} isIdentity`);
  }
});

test("param-domain: kinds + sizes derive correctly", () => {
  eq(paramInfo(find("skills:Studied Process"))?.kind, "pool", "Studied Process: inline pool");
  eq(paramInfo(find("skills:Studied Process"))?.size, 3, "Craft list size 3");
  eq(paramInfo(find("skills:Extended Capacity - Novice"))?.size, 2, "Sphere = 2");
  eq(paramInfo(find("skills:Lore"))?.kind, "distinct", "Lore: distinct");
  eq(paramInfo(find("skills:Additional Cantrip"))?.kind, "distinct", "Additional Cantrip: from-a-list → distinct");
  eq(paramInfo(find("perks:Elemental Affinity"))?.size, 4, "Element = 4");
});

const allEntities = () => {
  const flat = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.name) flat.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(skillsJson);
  walk(perksJson);
  walk(classesJson);
  return flat;
};

test("param-domain: build guard — no unresolved parameterized multi-rank entities", () => {
  const offenders = unresolvedParamDomains(allEntities());
  eq(
    offenders.length,
    0,
    "unresolved param domains (need derivation or a DECLARED entry): " +
      offenders.map((o) => `${o.name} cap=${o.cap} (${o.reason})`).join("; "),
  );
});
