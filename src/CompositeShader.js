/** Composite B onto A. */
const CompositeShader = {
  uniforms: {
    tDiffuseA: { value: null },
    tDiffuseB: { value: null },
    tDepthA: { value: null },
    tDepthB: { value: null },
  },
  vertexShader: `
varying vec2 vUv;

void main()
{
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: `
precision highp sampler2D;

uniform sampler2D tDiffuseA;
uniform sampler2D tDiffuseB;
uniform sampler2D tDepthA;
uniform sampler2D tDepthB;

varying vec2 vUv;

void main()
{
    float depthA = texture2D(tDepthA, vUv).r;
    float depthB = texture2D(tDepthB, vUv).r;
    // Default depth test chooses B over A if the B depth is *less than or equal to* A
    if (depthB <= depthA)
    {
      gl_FragColor = texture2D(tDiffuseB, vUv);
      gl_FragDepth = depthB;
    }
    else
    {
      gl_FragColor = texture2D(tDiffuseA, vUv);
      gl_FragDepth = depthA;
    }
}
`,
}

export { CompositeShader }
