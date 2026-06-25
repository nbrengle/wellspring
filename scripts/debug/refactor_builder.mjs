import fs from "fs";
import path from "path";

const srcFile = path.resolve("src/Builder.jsx");
let content = fs.readFileSync(srcFile, "utf8");

// 1. Remove SLOT_FIELD to entityPickerSpec
const regex1 = /\/\/ ─── SLOT MODEL ───[\s\S]*?function entityPickerSpec\(\{[\s\S]*?\}\s*\}\n/m;
content = content.replace(regex1, "");

// 2. Remove handleOpenClassPicker
const regex2 = /  const handleOpenClassPicker = useCallback\(\(\) => \{[\s\S]*?\}, \[character, handleAddClass\]\);\n/m;
content = content.replace(regex2, "");

// 3. Remove handleOpenAdd
const regex3 =
  /  const handleOpenAdd = useCallback\(\(kind\) => \{[\s\S]*?\}, \[character, handleAddEntity, report\.devotion, report\.owned\]\);\n/m;
content = content.replace(regex3, "");

// 4. Insert usePickers hook call
const insertionPoint = `const handleOpenSlot = useCallback((slot, index, isClear, fieldOverride) => {`;
const usePickersCall = `const { handleOpenClassPicker, handleOpenAdd } = usePickers({ character, report, setPicking, handleAddClass, handleAddEntity });\n\n  `;
content = content.replace(insertionPoint, usePickersCall + insertionPoint);

// 5. Add usePickers import
const importInsertion = `import RecipeChecker from "./RecipeChecker.jsx";\nimport { usePickers, powerPickerSpec } from "./hooks/usePickers.js";\n`;
content = content.replace(`import RecipeChecker from "./RecipeChecker.jsx";\n`, importInsertion);

fs.writeFileSync(srcFile, content, "utf8");
console.log("Builder.jsx refactored successfully.");
