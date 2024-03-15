import {
  BackSide,
  BoxGeometry,
  ByteType,
  Data3DTexture,
  DepthTexture,
  LinearFilter,
  Mesh,
  NoBlending,
  RedFormat,
  ShaderMaterial,
  UniformsUtils,
  WebGLRenderTarget,
} from "three"
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { CopyShader } from 'three/addons/shaders/CopyShader.js'
import {
  VolumeRenderShader,
  ProjectionType_Perspective,
  ProjectionType_Orthographic,
} from "./VolumeRenderShader.js"
import { CompositeShader } from "./CompositeShader.js"

// Volume is rendered to fixed-size render target to improve viewport performance
const VOLUME_RENDER_SIZE = 1024

class VolumeRenderPass extends Pass {
  constructor(camera, width, height, volumeData, { size, resolution }) {
    super()
    this.camera = camera
    this.width = width ?? 512
    this.height = height ?? 512

    this.volumeData = new Int8Array(resolution.x * resolution.y * resolution.z)
    this.volumeData.set(volumeData)
    this.volumeTexture = new Data3DTexture(
      this.volumeData,
      resolution.x,
      resolution.y,
      resolution.z,
    )
    this.volumeTexture.type = ByteType
    this.volumeTexture.format = RedFormat
    this.volumeTexture.internalFormat = "R8_SNORM"
    this.volumeTexture.minFilter = LinearFilter
    this.volumeTexture.magFilter = LinearFilter
    this.volumeTexture.needsUpdate = true

    this.volumeRenderTarget = new WebGLRenderTarget(VOLUME_RENDER_SIZE, VOLUME_RENDER_SIZE)
    this.volumeRenderTarget.depthTexture = new DepthTexture()
    this.volumeRenderMaterial = new ShaderMaterial({
      defines: Object.assign({}, VolumeRenderShader.defines),
      uniforms: UniformsUtils.clone(VolumeRenderShader.uniforms),
      vertexShader: VolumeRenderShader.vertexShader,
      fragmentShader: VolumeRenderShader.fragmentShader,
      blending: NoBlending,
      side: BackSide,
    })
    // viewToWorldMat/viewToModelMat are set before render
    this.volumeRenderMaterial.uniforms.shapeData.value = this.volumeTexture
    this.volumeRenderMaterial.uniforms.volumeSize.value.copy(size)

    this.boxGeometry = new BoxGeometry(size.x, size.y, size.z)
    this.boxMesh = new Mesh(this.boxGeometry, this.volumeRenderMaterial)

    this.compositeMaterial = new ShaderMaterial({
      uniforms: UniformsUtils.clone(CompositeShader.uniforms),
      vertexShader: CompositeShader.vertexShader,
      fragmentShader: CompositeShader.fragmentShader,
      blending: NoBlending,
      depthTest: false,
    })
    this.compositeMaterial.uniforms.tDiffuseB.value = this.volumeRenderTarget.texture
    this.compositeMaterial.uniforms.tDepthB.value = this.volumeRenderTarget.depthTexture

    this.copyRenderTarget = new WebGLRenderTarget(this.width, this.height)
    this.copyMaterial = new ShaderMaterial({
      uniforms: UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      blending: NoBlending,
      depthTest: false,
    })
    this.copyMaterial.uniforms.tDiffuse.value = this.copyRenderTarget.texture

    this.fsQuad = new FullScreenQuad()
  }

  dispose() {
    this.fsQuad.dispose()
    this.boxGeometry.dispose()

    this.copyRenderTarget.dispose()
    this.copyMaterial.dispose()

    this.compositeMaterial.dispose()

    this.volumeTexture.dispose()
    this.volumeRenderTarget.dispose()
    this.volumeRenderMaterial.dispose()
  }

  /* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
  render(renderer, writeBuffer, readBuffer, _deltaTime, _maskActive) {
    {
      // Force update camera matrices
      this.camera.updateMatrixWorld(true)

      const viewToWorld = this.volumeRenderMaterial.uniforms.viewToWorldMat.value
      viewToWorld.copy(this.camera.matrixWorld)

      const viewToModel = this.volumeRenderMaterial.uniforms.viewToModelMat.value
      const worldToModel = this.boxMesh.matrixWorld.clone().invert()
      viewToModel.multiplyMatrices(worldToModel, viewToWorld)

      if (this.camera.isPerspectiveCamera) {
        this.volumeRenderMaterial.uniforms.projectionType.value = ProjectionType_Perspective
      } else {
        // Default to orthographic projection
        this.volumeRenderMaterial.uniforms.projectionType.value = ProjectionType_Orthographic
      }

      renderer.setRenderTarget(this.volumeRenderTarget)
      renderer.render(this.boxMesh, this.camera)
    }

    this.compositeMaterial.uniforms.tDiffuseA.value = readBuffer.texture
    this.compositeMaterial.uniforms.tDepthA.value = readBuffer.depthTexture

    if (this.renderToScreen) {
      // Render directly to default render target
      renderer.setRenderTarget(null)
      this.fsQuad.material = this.compositeMaterial
      this.fsQuad.render(renderer)
    } else {
      // Render to temporary render target and copy to write buffer. This is necessary because the
      // EffectComposer read/write buffers point to the same target (can't read from and write to
      // the same target in the same draw call)!
      renderer.setRenderTarget(this.copyRenderTarget)
      this.fsQuad.material = this.compositeMaterial
      this.fsQuad.render(renderer)

      renderer.setRenderTarget(writeBuffer)
      this.fsQuad.material = this.copyMaterial
      this.fsQuad.render(renderer)
    }
  }

  setSize(width, height) {
    this.copyRenderTarget.setSize(width, height)
  }

  setVolume(volumeData, { size, resolution }) {
    if (resolution.x !== this.volumeTexture.image.width
        || resolution.y !== this.volumeTexture.image.height
        || resolution.z !== this.volumeTexture.image.depth) {
      this.volumeData = new Int8Array(resolution.x * resolution.y * resolution.z)
      this.volumeData.set(volumeData)
      this.volumeTexture.dispose()
      this.volumeTexture = new Data3DTexture(
        this.volumeData,
        resolution.x,
        resolution.y,
        resolution.z,
      )
      this.volumeTexture.type = ByteType
      this.volumeTexture.format = RedFormat
      this.volumeTexture.internalFormat = "R8_SNORM"
      this.volumeTexture.minFilter = LinearFilter
      this.volumeTexture.magFilter = LinearFilter
      this.volumeTexture.needsUpdate = true
      this.volumeRenderMaterial.uniforms.shapeData.value = this.volumeTexture
    } else {
      this.volumeData.set(volumeData)
      this.volumeTexture.needsUpdate = true
    }

    if (size.x !== this.boxGeometry.parameters.width
        || size.y !== this.boxGeometry.parameters.height
        || size.z !== this.boxGeometry.parameters.depth) {
      this.boxGeometry.dispose()
      this.boxGeometry = new BoxGeometry(size.x, size.y, size.z)
      this.boxMesh = new Mesh(this.boxGeometry, this.volumeRenderMaterial)
      this.volumeRenderMaterial.uniforms.volumeSize.value.copy(size)
    }
  }

  get visible() {
    return this.boxMesh.visible
  }

  set visible(v) {
    this.boxMesh.visible = v
  }
}

export { VolumeRenderPass }
