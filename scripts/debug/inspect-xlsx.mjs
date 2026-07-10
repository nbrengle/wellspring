import XLSX from "xlsx";
import { readFileSync } from "fs";

const buf = readFileSync("./Wellspring - Temp Character Sheet.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
console.log("Sheet Names:", wb.SheetNames);
const sheet = wb.Sheets[wb.SheetNames[0]];
const ref = sheet["!ref"];
console.log("Ref:", ref);

const range = XLSX.utils.decode_range(ref);
for (let r = range.s.r; r <= Math.min(range.e.r, 100); r++) {
  const row = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    row.push(cell ? cell.v : "");
  }
  if (row.some((x) => x !== "")) {
    console.log(`Row ${r}:`, row.map((x) => String(x).padEnd(20).substring(0, 20)).join(" | "));
  }
}
