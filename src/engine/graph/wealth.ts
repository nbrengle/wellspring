import type {
    WealthReport
} from "../types.js";
import type { CharacterGraphModel } from "./model.js";
export function computeWealth(graph: CharacterGraphModel): WealthReport {
    const DEFAULT_WEALTH = 8;
    const characterWealth = graph.character.wealth;
    const base =
      characterWealth != null && characterWealth !== ""
        ? parseInt(String(characterWealth), 10) || DEFAULT_WEALTH
        : DEFAULT_WEALTH;

    const sources: WealthReport["sources"] = [];
    let income = 0;

    const add = (source: string, amount: number, note: string) => {
      if (amount > 0) {
        income += amount;
        sources.push({ source, amount, note });
      }
    };

    // The graph already extracted all WEALTH effects (including the synthetic Tax Evasion)
    for (const node of graph.items) {
      for (const eff of node.effects) {
        if (eff.type === "WEALTH") {
          add(node.name, eff.amount, eff.note || "");
        }
      }
    }

    return { base, income, total: base + income, sources };
}
