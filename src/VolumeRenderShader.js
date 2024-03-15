import { Color, Matrix4, Vector3 } from "three"

const ProjectionType_Perspective = 0
const ProjectionType_Orthographic = 1

const VolumeRenderShader = {
  defines: {
    // Add compile-time definitions here, e.g.
    // MAX_RAYMARCH_STEPS: 128
  },
  uniforms: {
    shapeData: { value: null },
    viewToWorldMat: { value: new Matrix4() },
    viewToModelMat: { value: new Matrix4() },
    volumeSize: { value: new Vector3() },
    baseColor: { value: new Color(0xffffff) },
    projectionType: { value: ProjectionType_Perspective },
  },
  vertexShader: `
out vec3 viewPosition;

void main()
{
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    viewPosition = p.xyz;
    gl_Position = projectionMatrix * p;
}
`,
  fragmentShader: `
precision highp sampler3D;

uniform sampler3D shapeData;

// Automatically set to camera projectionMatrix by three.js
uniform mat4 projectionMatrix;

uniform mat4 viewToWorldMat;
uniform mat4 viewToModelMat;
uniform vec3 volumeSize;
uniform vec3 baseColor;
uniform int projectionType;

in vec3 viewPosition;

vec3 shapeTexelSize;
float snormWidth;
float distTol;

float opIntersection(float d0, float d1) { return max(d0, d1); }

float sdPlane(vec3 p, vec3 origin, vec3 normal) { return dot(normal, (p - origin)); }

float sdBox(vec3 p, vec3 extents)
{
    vec3 d = abs(p) - extents;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

vec3 modelToVolume(vec3 p)
{
    // NOTE: Volume is centered at origin of model space
    return p / volumeSize + 0.5;
}

vec3 viewToWorld(vec3 p) { return (viewToWorldMat * vec4(p, 1.0)).xyz; }

vec3 viewToModel(vec3 p) { return (viewToModelMat * vec4(p, 1.0)).xyz; }

vec3 viewToVolume(vec3 p) { return modelToVolume(viewToModel(p)); }

vec3 volumeToTexture(vec3 p, vec3 texelSize)
{
    // NOTE: Remaps [0, 1] to [h/2, 1.0 - h/2] where h is the size of a texel. This aligns the
    // boundary of the sampled volume with texel centers.
    return p * (1.0 - texelSize) + 0.5 * texelSize;
}

float sampleDistance(vec3 p)
{
    p = volumeToTexture(p, shapeTexelSize);
    float d = textureLod(shapeData, p, 0.0).r;

    // NOTE: Assumes the volume contains thresholded results in [-1, 1]. The value of snormWidth
    // should match the value of the width parameter used on the final threshold operator in the
    // evaluated graph.
    return d * snormWidth;
}

// Returns the signed distance at the given point in view space
float distanceAt(vec3 p)
{
    float dist = sampleDistance(viewToVolume(p));

    // NOTE: This assumes that viewToModel is a rigid transformation. If it isn't,
    // distances returned from sdBox will be incorrect.

    // Trim to volume
    return opIntersection(dist, sdBox(viewToModel(p), volumeSize * 0.5));
}

vec3 normalAt(vec3 p)
{
    vec3 h = volumeSize * shapeTexelSize * 0.5;

    // clang-format off
    vec3 grad = vec3(
        distanceAt(p + vec3(h.x, 0.0, 0.0)) - distanceAt(p - vec3(h.x, 0.0, 0.0)),
        distanceAt(p + vec3(0.0, h.y, 0.0)) - distanceAt(p - vec3(0.0, h.y, 0.0)),
        distanceAt(p + vec3(0.0, 0.0, h.z)) - distanceAt(p - vec3(0.0, 0.0, h.z)))
    / (2.0 * h);
    // clang-format on

    return normalize(grad);
}

vec3 colorAt(vec3 p)
{
    vec3 norm = normalAt(p);
    vec2 uv = (norm).xy * 0.5 + 0.5;
    return baseColor * vec3(mix(0.2, 0.8, uv.y));
}

// Returns the min component of the given vector
float cmin(vec3 u) { return min(u.x, min(u.y, u.z)); }

// Returns the max component of the given vector
float cmax(vec3 u) { return max(u.x, max(u.y, u.z)); }

// Returns parameters of near and far intersections between a ray and an axis-aligned box
vec2 intersectRayBox(vec3 rayStart, vec3 rayDir, vec3 boxCenter, vec3 boxExtents)
{
    vec3 invDir = 1.0 / rayDir;
    vec3 n = invDir * (boxCenter - rayStart);
    vec3 k = abs(invDir) * boxExtents;
    return vec2(cmax(n - k), cmin(n + k));
}

vec2 intersectRayVolume(vec3 rayStart, vec3 rayDir)
{
    // Transform the ray into model space and intersect with volume box
    rayStart = (viewToModelMat * vec4(rayStart, 1.0)).xyz;
    rayDir = (viewToModelMat * vec4(rayDir, 0.0)).xyz;
    return intersectRayBox(rayStart, rayDir, vec3(0.0), volumeSize * 0.5);
}

bool castRay(vec3 rayStart, vec3 rayDir, out float rayDist)
{
    // Assumes we're rendering back faces of the volume box
    float maxRayDist = dot(viewPosition, rayDir);

    // Start marching from first intersection on the volume box or the camera near plane (whichever
    // is closer)
    rayDist = max(0.0, intersectRayVolume(rayStart, rayDir)[0]);

    const int maxSteps = 128;
    for (int i = 0; i < maxSteps; ++i)
    {
        // Early out if we've exited the volume box
        if (rayDist > maxRayDist)
            return false;

        float dist = distanceAt(rayStart + rayDir * rayDist);
        if (dist <= distTol)
            break;

        rayDist += dist;
    }

    return true;
}

// Write depth for correct occlusion of raymarched geometry
void writeDepth(vec3 p)
{
    vec4 pClip = projectionMatrix * vec4(p, 1.0);
    float ndcZ = pClip.z / pClip.w;

    // NOTE: This assumes NDC z interval is [-1, 1] (i.e. OpenGL convention)
    gl_FragDepth = ndcZ * 0.5 + 0.5; // Remap to [0, 1]
}

void initRay(out vec3 start, out vec3 dir)
{
    const int ProjectionType_Perspective = 0;
    const int ProjectionType_Orthographic = 1;

    if (projectionType == ProjectionType_Perspective)
    {
        start = vec3(0.0);
        dir = normalize(viewPosition);
    }
    else if (projectionType == ProjectionType_Orthographic)
    {
        start = vec3(viewPosition.xy, 0);
        dir = vec3(0.0, 0.0, -1.0);
    }
}

void main()
{
    // Initialize globals
    {
        shapeTexelSize = 1.0 / vec3(textureSize(shapeData, 0) - 1);
        snormWidth = length(volumeSize) * 1.0e-2;
        distTol = length(volumeSize * shapeTexelSize) * 1.0e-3;
    }

    // Render
    {
        vec3 rayStart, rayDir;
        initRay(rayStart, rayDir);

        float rayDist;
        if (castRay(rayStart, rayDir, rayDist))
        {
            vec3 p = rayStart + rayDir * rayDist;
            gl_FragColor = vec4(colorAt(p), 1.0);
            writeDepth(p);
        }
        else
        {
            discard;
        }
    }
}
`
}

export { VolumeRenderShader, ProjectionType_Perspective, ProjectionType_Orthographic }
