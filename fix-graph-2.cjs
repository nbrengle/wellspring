const fs = require("fs");
let graph = fs.readFileSync("src/engine/graph.ts", "utf8");

// revert the constructor mess
graph = graph.replace("public items: GraphItem[],\n    private _items: GraphItem[],", "public items: GraphItem[],");

// replace all `this._items` with `this.items`
graph = graph.replace(/this\._items/g, "this.items");

fs.writeFileSync("src/engine/graph.ts", graph);
