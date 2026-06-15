export function wealthState(graph, characterWealth) {
  const DEFAULT_WEALTH = 8;
  const base = characterWealth != null && characterWealth !== ''
    ? (parseInt(String(characterWealth), 10) || DEFAULT_WEALTH)
    : DEFAULT_WEALTH;
    
  const sources = [];
  let income = 0;

  const add = (name, n, note) => { 
    if (n > 0) { 
      income += n; 
      sources.push({ name, n, note }); 
    } 
  };

  // The graph already extracted all WEALTH effects (including the synthetic Tax Evasion)
  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type === 'WEALTH') {
        add(node.name, eff.amount, eff.note);
      }
    }
  }

  return { base, income, total: base + income, sources };
}
