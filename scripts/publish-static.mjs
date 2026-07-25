import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const buildRoot = fileURLToPath(new URL("../dist/", import.meta.url));

rmSync(`${projectRoot}assets`, { recursive: true, force: true });
mkdirSync(`${projectRoot}assets`, { recursive: true });
copyFileSync(`${buildRoot}index.html`, `${projectRoot}index.html`);
cpSync(`${buildRoot}assets`, `${projectRoot}assets`, { recursive: true });
