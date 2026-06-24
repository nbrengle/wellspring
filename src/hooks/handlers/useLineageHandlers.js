import { useCallback } from "react";
import { LINEAGES } from "../../engine/data.js";
import { requiredChallengeNames } from "../../components/lineage/lineage-helpers.js";
import { cleanChallengeName } from "../../components/LineagePanel.jsx";

const subKey = (n) => (n || "general").toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function useLineageHandlers({ setCharacter }) {
  const handleSetLineage = useCallback((name) => {
    setCharacter((c) =>
      name === c.lineage
        ? c
        : {
            ...c,
            lineage: name,
            sublineage: null,
            lineageChallenges: requiredChallengeNames(LINEAGES[name], null),
            lineageAdvantages: [],
          },
    );
  }, [setCharacter]);

  const handleSetSublineage = useCallback((sub) => {
    setCharacter((c) => {
      const next = c.sublineage === sub ? null : sub;
      const lin = LINEAGES[c.lineage];
      const nextKey = next ? subKey(next) : null;
      const keep = (names, list) =>
        (names || []).filter((n) => {
          const item = (list || []).find((x) => cleanChallengeName(n) === cleanChallengeName(x.baseName || x.name));
          const k = item ? subKey(item.sublineage) : null;
          return !k || k === "general" || k === nextKey;
        });
      const challenges = keep(c.lineageChallenges, lin?.challenges);
      const advantages = keep(c.lineageAdvantages, lin?.advantages);
      for (const r of requiredChallengeNames(lin, next)) {
        if (!challenges.some((x) => cleanChallengeName(x) === cleanChallengeName(r))) challenges.push(r);
      }
      return { ...c, sublineage: next, lineageChallenges: challenges, lineageAdvantages: advantages };
    });
  }, [setCharacter]);

  const handleToggleLineageItem = useCallback((field, name) => {
    setCharacter((c) => {
      const cur = c[field] || [];
      const clean = cleanChallengeName(name);
      const exists = cur.some((x) => cleanChallengeName(x) === clean);
      if (exists) {
        return { ...c, [field]: cur.filter((x) => cleanChallengeName(x) !== clean) };
      } else {
        return { ...c, [field]: [...cur, name] };
      }
    });
  }, [setCharacter]);

  const handleSetLineageRep = useCallback((field, baseName, rep) => {
    setCharacter((c) => {
      const cur = c[field] || [];
      const next = rep && rep.trim() ? `${baseName} (${rep.trim()})` : baseName;
      const i = cur.findIndex((x) => cleanChallengeName(x) === cleanChallengeName(baseName));
      const out = [...cur];
      if (i === -1) out.push(next);
      else out[i] = next;
      return { ...c, [field]: out };
    });
  }, [setCharacter]);

  const handleSetAdvantageChoice = useCallback((advantage, value) => {
    setCharacter((c) => ({
      ...c,
      advantageChoices: { ...(c.advantageChoices || {}), [advantage]: value },
    }));
  }, [setCharacter]);

  return {
    handleSetLineage,
    handleSetSublineage,
    handleToggleLineageItem,
    handleSetLineageRep,
    handleSetAdvantageChoice,
  };
}
