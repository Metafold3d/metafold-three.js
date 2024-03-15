# Metafold three.js addons

[![npm](https://img.shields.io/npm/v/@metafold/threejs.svg)](https://www.npmjs.org/package/@metafold/threejs)

## Installation

Include the following imports in the HTML head element, adjusting version numbers as appropriate:

```html
<head>
  <!-- ... -->
  <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.162.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.162.0/examples/jsm/",
        "@metafold/threejs/": "https://unpkg.com/@metafold/threejs@0.1.0/dist/"
      }
    }
  </script>
</head>
```

## Usage

As with the [three.js post-processing guide][], start by importing the required passes:

```javascript
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { VolumeRenderPass } from "@metafold/threejs/VolumeRenderPass.js"
```

In this example we include a standard scene `RenderPass` and the `VolumeRenderPass` introduced by
this addon.

```javascript
const renderTarget = new THREE.WebGLRenderTarget(width, height)
renderTarget.depthTexture = new THREE.DepthTexture()

const composer = new EffectComposer(renderer, renderTarget)
```

Note the `EffectComposer` should be initialized with a render target that **includes a depth
texture** to make the depth of previous passes available to the `VolumeRenderPass`. This enables the
`VolumeRenderPass` to composite the rendered shape with any geometry from previous passes.

```javascript
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

// Dummy data to initialize volume render pass
const volumeData = new Int8Array(64 * 64 * 64)
volumeData.fill(127)

const volumeRenderPass = new VolumeRenderPass(camera, width, height, volumeData, {
  size: new THREE.Vector3(2.0, 2.0, 2.0),
  offset: new THREE.Vector3(-1.0, -1.0, -1.0),
  // The resolution *must* match the volume data length
  resolution: new THREE.Vector3(64, 64, 64),
})
composer.addPass(volumeRenderPass)

const outputPass = new OutputPass()
composer.addPass(outputPass)
```

Initializing the `VolumeRenderPass` is simple as that!

After receiving volume data from the Metafold API, set the data on the pass as an `Int8Array` and
provide the corresponding patch parameters (size and resolution):

```javascript
const volumeData = new Int8Array(buffer)
volumeRenderPass.setVolume(volumeData, { size, resolution })
```

See [examples/lattice_infill](examples/lattice_infill) for a complete example (including
[Metafold SDK for Node.js][] usage)!

[three.js post-processing guide]: https://threejs.org/docs/index.html#manual/en/introduction/How-to-use-post-processing
[Metafold SDK for Node.js]: https://github.com/Metafold3d/metafold-node
