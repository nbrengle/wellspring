import { useCallback } from "react";
import { getClasses } from "../../engine/resolver.js";
import { applyClassStartingAbilities } from "../../engine/character-state.js";
import { pickClass } from "../../engine/validate.js";
import { LEVEL_TABLE } from "../../engine/data.js";

const MAX_LEVEL = LEVEL_TABLE.length ? Math.max(...LEVEL_TABLE.map((l) => l.level)) : 15;
const MIN_LEVEL = 1;

export function useClassHandlers({ setCharacter }) {
  const handleLevelChange = useCallback((next) => {
    const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next));
    setCharacter((c) => {
      if (!c.classLevels) return c;
      return { ...c, classLevels: c.classLevels.replace(/\d+/, String(level)) };
    });
  }, [setCharacter]);

  const toClassesForm = (c) => {
    if (Array.isArray(c.classes) && c.classes.length) return c;
    const classes = getClasses(c);
    return { ...c, classes, classLevels: undefined };
  };

  const handleSetClassLevel = useCallback((className, level) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      const others = c.classes.filter((x) => x.name !== className).reduce((n, x) => n + x.level, 0);
      const lvl = Math.max(1, Math.min(MAX_LEVEL - others, level));
      const nextClasses = c.classes.map((x) => (x.name === className ? { ...x, level: lvl } : x));
      let updated = { ...c, classes: nextClasses };
      const primary = nextClasses[0];
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      return updated;
    });
  }, [setCharacter]);

  const handleAddClass = useCallback((className) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      if (c.classes.some((x) => x.name === className)) return c0;
      const nextClasses = [...c.classes, { name: className, level: 1 }];
      let updated = { ...c, classes: nextClasses };
      const primary = nextClasses[0];
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      updated = applyClassStartingAbilities(updated, className, 1);
      return updated;
    });
  }, [setCharacter]);

  const handleRemoveClass = useCallback((className, SLOT_FIELD) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      if (c.classes.length <= 1) return c0;
      const classes = c.classes.filter((x) => x.name !== className);
      const next = { ...c, classes };
      for (const field of Object.values(SLOT_FIELD)) {
        const picks = c[field];
        if (!picks) continue;
        const keep = picks
          .map((name, i) => ({ name, i }))
          .filter(({ name, i }) => pickClass(c, field, i, name) !== className);
        next[field] = keep.map((k) => k.name);
        if (c.powerClass?.[field]) {
          next.powerClass = { ...(next.powerClass || c.powerClass) };
          next.powerClass[field] = keep.map((k) => c.powerClass[field][k.i]);
        }
      }
      const primary = classes[0];
      let updated = next;
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      return updated;
    });
  }, [setCharacter]);

  return {
    handleLevelChange,
    handleSetClassLevel,
    handleAddClass,
    handleRemoveClass,
  };
}
