import { build as esbuild } from "esbuild";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Works from the repo root and from the package directory, where `npm pack` runs prepack.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
// esbuild reads the working directory when it is imported, so the chdir above does not reach it.
const build = (options) => esbuild({ absWorkingDir: root, ...options });
const dir = "packages/whofills";
rmSync(`${dir}/dist`, { recursive: true, force: true });
mkdirSync(`${dir}/dist/server`, { recursive: true });
const browser = { bundle: true, minify: true, format: "iife", target: "es2020", legalComments: "none" };
await build({ ...browser, entryPoints: [`${dir}/src/client.ts`], outfile: `${dir}/dist/whofills.js` });
await build({ ...browser, entryPoints: [`${dir}/src/hold-page.ts`], outfile: `${dir}/dist/hold.js` });
const server = { entryPoints: [`${dir}/src/server/index.ts`], bundle: true, platform: "node", target: "node20" };
await build({ ...server, outfile: `${dir}/dist/server/index.js`, format: "esm" });
await build({ ...server, outfile: `${dir}/dist/server/index.cjs`, format: "cjs" });
await build({
  entryPoints: [`${dir}/src/react.tsx`],
  outfile: `${dir}/dist/react.js`,
  bundle: true,
  format: "esm",
  external: ["react"],
  target: "es2020",
});
// The CLI keeps its functions readable: page probes are sent to the browser as source text.
await build({
  entryPoints: [`${dir}/src/cli/main.ts`],
  outfile: `${dir}/dist/cli.js`,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
});
chmodSync(`${dir}/dist/cli.js`, 0o755);

// The mutation check skips this: a mutant with a type error would fail the build and count as caught by no test at all.
if (!process.argv.includes("--no-types")) {
  const tsc = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", `${dir}/tsconfig.build.json`], {
    encoding: "utf8",
  });
  if (tsc.status !== 0) {
    console.error(tsc.stdout, tsc.stderr);
    process.exit(1);
  }
  // The sources import "./x.ts". A published declaration has to point at the emitted "./x.js".
  const declarations = (d) =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? declarations(p) : p.endsWith(".d.ts") ? [p] : [];
    });
  for (const f of declarations(`${dir}/dist`))
    writeFileSync(f, readFileSync(f, "utf8").replace(/(from\s+["']\.[^"']*)\.tsx?(["'])/g, "$1.js$2"));
}

for (const f of ["whofills.js", "hold.js"]) {
  const b = readFileSync(`${dir}/dist/${f}`);
  console.log(f, b.length, "bytes,", gzipSync(b).length, "gz");
}
