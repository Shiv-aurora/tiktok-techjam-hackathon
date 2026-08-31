import { copyFile } from "node:fs/promises";

await copyFile(
  new URL("../src/runtime-observer.cjs", import.meta.url),
  new URL("../dist/runtime-observer.cjs", import.meta.url),
);
