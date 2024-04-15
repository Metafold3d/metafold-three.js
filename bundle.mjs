import * as esbuild from "esbuild"

await esbuild.build({
  entryPoints: ["src/main.js"],
  external: ["three"],
  format: "esm",
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: "dist/main.js",
})
