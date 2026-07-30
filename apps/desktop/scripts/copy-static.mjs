import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcUi = join(__dirname, "..", "src", "ui");
const distUi = join(__dirname, "..", "dist", "ui");

mkdirSync(distUi, { recursive: true });
for (const file of ["index.html", "app.js", "styles.css"]) {
  const src = join(srcUi, file);
  if (existsSync(src)) copyFileSync(src, join(distUi, file));
}

console.log("Copied desktop UI assets");
