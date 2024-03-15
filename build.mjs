import * as esbuild from "esbuild"

await esbuild.build({
  entryPoints: [
    "src/CompositeShader.js",
    "src/VolumeRenderPass.js",
    "src/VolumeRenderShader.js",
  ],
  minify: true,
  sourcemap: true,
  outdir: "dist",
})
