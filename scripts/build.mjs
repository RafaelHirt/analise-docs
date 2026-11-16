import { mkdir, copyFile, cp } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const destination = new URL("public/vendor/", root);
await mkdir(destination, { recursive: true });
for (const [source, filename] of [
  ["pdfjs-dist/legacy/build/pdf.min.mjs", "pdf.min.mjs"],
  ["pdfjs-dist/legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["mammoth/mammoth.browser.min.js", "mammoth.browser.min.js"],
  ["exceljs/dist/exceljs.min.js", "exceljs.min.js"],
  ["@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "inter-latin-wght-normal.woff2"],
]) {
  await copyFile(new URL(`node_modules/${source}`, root), new URL(filename, destination));
}
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(new URL(`node_modules/pdfjs-dist/${directory}/`, root), new URL(`${directory}/`, destination), { recursive: true });
}

// Preserve the licenses of assets redistributed by this build.
for (const [source, filename] of [
  ["@fontsource-variable/inter/LICENSE", "inter-LICENSE.txt"],
  ["pdfjs-dist/LICENSE", "pdfjs-LICENSE.txt"],
  ["mammoth/LICENSE", "mammoth-LICENSE.txt"],
  ["exceljs/LICENSE", "exceljs-LICENSE.txt"],
]) {
  await copyFile(new URL(`node_modules/${source}`, root), new URL(filename, destination));
}
