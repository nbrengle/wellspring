import { useCallback } from "react";
import { DEVOTIONS, DOMAINS } from "../../engine/data.js";
import { formatParameterizedName } from "../../engine/resolver.js";
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
          const updateWorship = (list) =>
            list.map((s) => (/^worship\b/i.test(s) ? formatParameterizedName("Worship", name, s) : s));
          // Purchased skills are V2 CharacterChoice[] in `skills`; patch the Worship
          // entry's entityId. Starting skills are still flat strings.
          const updateWorshipSkills = (skills) =>
            (skills || []).map((sk) =>
              /^worship\b/i.test(sk.entityId) ? { ...sk, entityId: formatParameterizedName("Worship", name, sk.entityId) } : sk,
            );
          return {
            ...c,
            devotion: name,
            divineDomains: (c.divineDomains || []).filter((dn) => dev?.domains.includes(dn)),
            startingSkills: updateWorship(c.startingSkills || []),
            skills: updateWorshipSkills(c.skills),
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
      const clearWorshipSkills = (skills) =>
        (skills || []).map((sk) => (/^worship\b/i.test(sk.entityId) ? { ...sk, entityId: "Worship" } : sk));
      return {
        ...c,
        devotion: null,
        divineDomains: [],
        domainPowers: [],
        startingSkills: clearWorship(c.startingSkills || []),
        skills: clearWorshipSkills(c.skills),
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
