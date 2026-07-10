const fs = require("fs");

let graph = fs.readFileSync("src/engine/graph.ts", "utf8");

// 1. CharacterGraphModel getter for items
graph = graph.replace("private _items: GraphItem[],", "public items: GraphItem[],\n    private _items: GraphItem[],");

// 2. 333: cleanItemName(node.rawString || node.name)
graph = graph.replace("cleanItemName(node.rawString);", "cleanItemName(node.rawString || node.name);");

// 3. 352: if (node.entity) -> if (node.entity?.id)
graph = graph.replace("if (node.entity) {", "if (node.entity?.id) {");

// 4. 699: elemAffinities.push(node.rawString || node.name)
graph = graph.replace("elemAffinities.push(node.rawString);", "elemAffinities.push(node.rawString || node.name);");

// 5. 725: bloodlines.push(node.rawString || node.name)
graph = graph.replace("bloodlines.push(node.rawString);", "bloodlines.push(node.rawString || node.name);");

// 6. 822: add(node.name, eff.amount, eff.note || "")
graph = graph.replace("add(node.name, eff.amount, eff.note);", 'add(node.name, eff.amount, eff.note || "");');

// 7. 1001: cleanItemName(node.rawString || node.name)
graph = graph.replace(
  'cleanItemName(node.rawString).split(" ")[0];',
  'cleanItemName(node.rawString || node.name).split(" ")[0];',
);

// 8. 1015: (eff.freeRanks || 0)
graph = graph.replace("eff.freeRanks > 0", "(eff.freeRanks || 0) > 0");

// 9. 1045: costKey guard
graph = graph.replace(
  "if (node.costEntry) byItem[costKey(node)] = node.costEntry;",
  "const k = costKey(node); if (node.costEntry && k) byItem[k] = node.costEntry;",
);

// 10. 1093: boolean fallback
graph = graph.replace(
  '!!pr && (pr.skills?.includes(target) || pr.other?.some((o: string) => new RegExp(src.scope.value, "i").test(o)))',
  '!!pr && (pr.skills?.includes(target) || !!pr.other?.some((o: string) => new RegExp(src.scope.value, "i").test(o)))',
);

// 11. 1158: slots fallback
graph = graph.replace("Object.values(slots).reduce", "Object.values(slots || {}).reduce");

fs.writeFileSync("src/engine/graph.ts", graph);
