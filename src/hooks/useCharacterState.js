import { useState, useEffect, useMemo } from "react";
import { EMPTY_CHARACTER } from "../engine/character-state.js";
import { validate } from "../engine/validate.js";

// ─── URL HASH PERSISTENCE ────────────────────────────────────────────────────
export function readFromHash() {
  const h = window.location.hash.slice(1);
  if (!h) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(h))));
  } catch {
    return null;
  }
}

export function writeToHash(character) {
  if (!character.archetypeName && !character.name && !(character.skills || []).length) {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    return;
  }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(character))));
  window.history.replaceState(null, "", `${window.location.pathname}#${encoded}`);
}

// ─── REACT CUSTOM STATE HOOK ─────────────────────────────────────────────────
export function useCharacterState() {
  const [character, setCharacter] = useState(() => readFromHash() || EMPTY_CHARACTER);

  const report = useMemo(() => validate(character), [character]);

  useEffect(() => {
    writeToHash(character);
  }, [character]);

  useEffect(() => {
    const onHashChange = () => {
      const next = readFromHash();
      if (next) setCharacter(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return { character, setCharacter, report };
}
