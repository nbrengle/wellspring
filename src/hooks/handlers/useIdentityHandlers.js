import { useCallback } from "react";
import { DEVOTIONS, DOMAINS } from "../../engine/data.js";
import { formatParameterizedName } from "../../components/DetailPane.jsx";
import { MAX_DOMAINS } from "../../engine/validate.js";

export function useIdentityHandlers({ character, setCharacter, setPicking }) {
  const handleSetName = useCallback((name) => {
    setCharacter((c) => ({ ...c, name }));
  }, [setCharacter]);

  const handlePickDevotion = useCallback(() => {
    const candidates = DEVOTIONS.map((d) => ({
      name: d.name,
      desc: d.lore || (d.tenets || []).join(" "),
      cat: d.locality || "Devotion",
    }));
    setPicking({
      kind: "devotion",
      entityType: "devotions",
      candidates,
      title: "Choose a devotion",
      taken: new Set(character.devotion ? [character.devotion] : []),
      onChoose: (name) => {
        const dev = DEVOTIONS.find((d) => d.name === name);
        setCharacter((c) => {
          const updateWorship = (list) => {
            return list.map((s) => {
              if (/^worship\b/i.test(s)) return formatParameterizedName("Worship", name, s);
              return s;
            });
          };
          return {
            ...c,
            devotion: name,
            divineDomains: (c.divineDomains || []).filter((dn) => dev?.domains.includes(dn)),
            startingSkills: updateWorship(c.startingSkills || []),
            purchasedSkills: updateWorship(c.purchasedSkills || []),
          };
        });
        setPicking(null);
      },
    });
  }, [character.devotion, setPicking, setCharacter]);

  const handleToggleDomain = useCallback((domain) => {
    setCharacter((c) => {
      const cur = c.divineDomains || [];
      if (cur.includes(domain)) {
        const nextDomains = cur.filter((d) => d !== domain);
        const domPowers = (DOMAINS.find((x) => x.name === domain)?.powers || []).map((p) => p.name);
        return {
          ...c,
          divineDomains: nextDomains,
          domainPowers: (c.domainPowers || []).filter(
            (p) => !domPowers.includes(p.replace(/\s*\(.+\)$/, "")) && !domPowers.includes(p),
          ),
        };
      }
      if (cur.length >= MAX_DOMAINS) return c;
      return { ...c, divineDomains: [...cur, domain] };
    });
  }, [setCharacter]);

  const handleClearDevotion = useCallback(() => {
    setCharacter((c) => {
      const clearWorship = (list) => list.map((s) => (/^worship\b/i.test(s) ? "Worship" : s));
      return {
        ...c,
        devotion: null,
        divineDomains: [],
        domainPowers: [],
        startingSkills: clearWorship(c.startingSkills || []),
        purchasedSkills: clearWorship(c.purchasedSkills || []),
      };
    });
  }, [setCharacter]);

  const handleToggleBackstory = useCallback(() => {
    setCharacter((c) => ({ ...c, backstoryApproved: !c.backstoryApproved }));
  }, [setCharacter]);

  return {
    handleSetName,
    handlePickDevotion,
    handleToggleDomain,
    handleClearDevotion,
    handleToggleBackstory,
  };
}
