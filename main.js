import MetafoldClient from "metafold"
import * as THREE from "three"
import WebGL from "three/addons/capabilities/WebGL.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import { VolumeRenderPass } from "@metafold/threejs/VolumeRenderPass.js"

THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

const appContext = {
  /** Metafold REST API client. */
  metafold: null,

  /** three.js mesh. */
  mesh: null,

  /**
   * Parameters of box containing the implicit shape.
   * At Metafold we refer to these parameters as a "patch".
   */
  patch: {
    size: new THREE.Vector3(2.0, 2.0, 2.0),
    offset: new THREE.Vector3(-1.0, -1.0, -1.0),
    resolution: new THREE.Vector3(256, 256, 256),
  },

  /** Implicit shape graph. */
  graph: null,
}

function main() {
  // three.js boilerplate
  const mainElement = document.getElementsByTagName("main")[0]
  if (!WebGL.isWebGL2Available()) {
    mainElement.appendChild(WebGL.getWebGL2ErrorMessage())
    return
  }

  const renderer = new THREE.WebGLRenderer()
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(mainElement.clientWidth, mainElement.clientHeight)
  mainElement.appendChild(renderer.domElement)

  const aspect = mainElement.clientWidth / mainElement.clientHeight
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000)
  camera.position.set(0, 250, 100)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false

  // Volume renderer requires scene depth so we attach a depth texture to the
  // render target used by the EffectComposer.
  const renderTarget = new THREE.WebGLRenderTarget(
    mainElement.clientWidth, mainElement.clientHeight)
  renderTarget.depthTexture = new THREE.DepthTexture()

  const composer = new EffectComposer(renderer, renderTarget)

  window.addEventListener("resize", function () {
    composer.setSize(mainElement.clientWidth, mainElement.clientHeight)
    renderer.setSize(mainElement.clientWidth, mainElement.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    camera.aspect = mainElement.clientWidth / mainElement.clientHeight
    camera.updateProjectionMatrix()
  })

  const scene = new THREE.Scene()

  const overrideMaterial = new THREE.MeshMatcapMaterial()
  const renderPass = new RenderPass(scene, camera, overrideMaterial)
  composer.addPass(renderPass)

  // Dummy data to initialize volume render pass
  const volumeData = new Int8Array(256 * 256 * 256)
  volumeData.fill(127)

  // Add volume render pass to render shape volume on together with three.js scene
  const volumeRenderPass = new VolumeRenderPass(
    camera,
    mainElement.clientWidth,
    mainElement.clientHeight,
    volumeData, appContext.patch,
  )
  composer.addPass(volumeRenderPass)

  const outputPass = new OutputPass()
  composer.addPass(outputPass)

  const meshSelect = document.getElementById("mesh")

  const objLoader = new OBJLoader()
  objLoader.load(
    meshSelect.value,
    function (mesh) {
      console.debug("Loaded default mesh")
      scene.add(mesh)
      appContext.mesh = mesh
    },
  )

  meshSelect.addEventListener("change", function (e) {
    if (e.target) {
      const meshFilename = e.target.value
      objLoader.load(
        meshFilename,
        function (mesh) {
          console.debug("Loaded mesh: %s", meshFilename)
          if (appContext.mesh) {
            const child = appContext.mesh.children[0]
            child.removeFromParent()
            child.geometry.dispose()
            child.material.dispose()
          }
          scene.add(mesh)
          appContext.mesh = mesh

          volumeRenderPass.visible = false
        },
      )
    }
  })

  const showMeshButton = document.getElementById("showMesh")
  showMeshButton.addEventListener("click", function () {
    if (appContext.mesh) {
      appContext.mesh.visible = !appContext.mesh.visible
    }
  })

  const fillButton = document.getElementById("fill")
  fillButton.addEventListener("click", async function () {
    const spinner = document.getElementById("spinner")
    spinner.classList.remove("hidden")

    const accessTokenInput = document.getElementById("accessToken")
    const projectIDInput = document.getElementById("projectID")

    appContext.metafold = new MetafoldClient(accessTokenInput.value, projectIDInput.value)

    const scaleXInput = document.getElementById("scaleX")
    const scaleYInput = document.getElementById("scaleY")
    const scaleZInput = document.getElementById("scaleZ")

    const scale = new THREE.Vector3(
      Number(scaleXInput.value),
      Number(scaleYInput.value),
      Number(scaleZInput.value),
    )

    const meshSelect = document.getElementById("mesh")
    const meshFilename = meshSelect.value

    const volumeData = await updateShape(meshFilename, scale)
    console.debug("Received: %d", volumeData.byteLength)
    volumeRenderPass.setVolume(volumeData, appContext.patch)
    volumeRenderPass.visible = true

    appContext.mesh.visible = false

    spinner.classList.add("hidden")
  })

  const exportButton = document.getElementById("export")
  exportButton.addEventListener("click", async function () {
    const spinner = document.getElementById("spinner")
    spinner.classList.remove("hidden")

    // Assumes update process has been run prior to export
    console.debug("Running `export_triangle_mesh` job...")
    const exportMesh = await appContext.metafold.jobs.run("export_triangle_mesh", {
      graph: appContext.graph,
      point_source: 0,
      file_type: "obj",
    })

    console.debug("Getting temporary download URL...")
    const downloadURL = await appContext.metafold.assets.downloadURL(exportMesh.assets[0].id, {
      filename: `metafold_export_${Date.now()}.obj`,
    })

    const a = document.createElement("a")
    a.style.display = "none"
    a.setAttribute("href", downloadURL)
    a.setAttribute("download", "") // Set boolean attribute to `true`

    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    spinner.classList.add("hidden")
  })

  const render = function () {
    window.requestAnimationFrame(render)
    composer.render()
  }
  window.requestAnimationFrame(render)
}

async function updateShape(filename, scale) {
  let mesh = null
  {
    const r = await fetch(filename)
    const data = await r.blob()
    const file = new File([data], filename)

    // Upload (or update if already existing) given asset to project
    console.debug("Creating mesh asset...")
    const existing = await appContext.metafold.assets.list({ q: `filename:${filename}` })
    if (existing && existing.length > 0) {
      mesh = await appContext.metafold.assets.update(existing[0].id, file)
    } else {
      mesh = await appContext.metafold.assets.create(file)
    }
  }

  // Sample mesh into volume asset
  console.debug("Running `sample_triangle_mesh` job...")
  const sampleMesh = await appContext.metafold.jobs.run("sample_triangle_mesh", {
    mesh_filename: mesh.filename,
    max_resolution: 256,
  })

  // Create infill shape graph
  const volumeFilename = sampleMesh.assets[0].filename

  const patch = sampleMesh.meta.patch
  appContext.patch.size.fromArray(patch.size)
  appContext.patch.offset.fromArray(patch.offset)
  appContext.patch.resolution.fromArray(patch.resolution)

  // SDF narrow-band width is relative to grid cell size
  const cellSize = appContext.patch.size.clone()
    .divide(appContext.patch.resolution.clone().subScalar(1))
  const width = cellSize.length() * 3.0

  appContext.graph = {
    operators: [
      {
        type: "GenerateSamplePoints",
        parameters: { ...patch },
      },
      {
        type: "LoadVolume",
        parameters: {
          volume_data: {
            file_type: "Raw",
            path: volumeFilename,
          },
          resolution: patch.resolution,
        },
      },
      {
        type: "SampleVolume",
        parameters: {
          volume_size: patch.size,
          volume_offset: patch.offset,
        },
      },
      {
        type: "SampleSurfaceLattice",
        parameters: {
          lattice_type: "Gyroid",
          scale: scale.toArray(),
        },
      },
      {
        type: "CSG",
        parameters: {
          operation: "Intersect",
        },
      },
      {
        type: "Redistance",
        parameters: {
          size: patch.size,
        }
      },
      {
        type: "Threshold",
        parameters: { width }
      },
    ],
    edges: [
      { source: 0, target: [2, "Points"] },  // GenerateSamplePoints -> SampleVolume
      { source: 1, target: [2, "Volume"] },  // LoadVolume -> SampleVolume
      { source: 2, target: [4, "A"] },       // SampleVolume -> CSG
      { source: 0, target: [3, "Points"] },  // GenerateSamplePoints -> SampleSurfaceLattice
      { source: 3, target: [4, "B"] },       // SampleSurfaceLattice -> CSG
      { source: 4, target: [5, "Samples"] }, // CSG -> Redistance
      { source: 5, target: [6, "Samples"] }, // Redistance -> Threshold
    ]
  }

  // Evaluate graph using cloud-based implicit geometry kernel
  console.debug("Running `evaluate_graph` job...")
  const evalGraph = await appContext.metafold.jobs.run("evaluate_graph", {
    graph: appContext.graph,
  })

  // Download volume
  console.debug("Downloading `evaluate_graph` result...")
  const r = await appContext.metafold.assets.download(evalGraph.assets[0].id, "arraybuffer")
  return new Int8Array(r.data)
}

main()
