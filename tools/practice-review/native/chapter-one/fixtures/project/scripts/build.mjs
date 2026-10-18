import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await copyFile("apps/frontend/index.html", "dist/index.html");
