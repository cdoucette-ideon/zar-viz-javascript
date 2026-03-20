precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uColormap;
uniform float uThresholdMin;
uniform float uThresholdMax;
uniform float uOpacity;
uniform float uSteps;
uniform float uDensityScale;   // ← new: controls how solid the volume looks
uniform vec3  uVoxelSize;

varying vec3 vOrigin;
varying vec3 vDirection;

vec2 hitBox(vec3 orig, vec3 dir) {
  vec3 invDir = 1.0 / dir;
  vec3 tMin = (-0.5 - orig) * invDir;
  vec3 tMax = ( 0.5 - orig) * invDir;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar  = min(min(t2.x, t2.y), t2.z);
  return vec2(tNear, tFar);
}

void main() {
  vec3 rayDir = normalize(vDirection);

  vec2 bounds = hitBox(vOrigin, rayDir);
  if (bounds.x >= bounds.y) discard;
  bounds.x = max(bounds.x, 0.0);

  float stepSize = 1.0 / uSteps;

  vec4  accum = vec4(0.0);
  float t     = bounds.x + stepSize * 0.5;

  for (int i = 0; i < 512; i++) {
    if (t >= bounds.y) break;

    vec3  pos     = vOrigin + t * rayDir + 0.5;
    float density = texture(uVolume, pos).r;

    if (density >= uThresholdMin && density <= uThresholdMax) {
      vec4  colour = texture(uColormap, vec2(density, 0.5));

      // uDensityScale replaces the hardcoded 8.0
      // low (~1-5)  = wispy/transparent
      // mid (~20)   = semi-solid
      // high (~100) = fully opaque/solid
      float alpha = colour.a * uOpacity * stepSize * uDensityScale;

      accum.rgb += (1.0 - accum.a) * colour.rgb * alpha;
      accum.a   += (1.0 - accum.a) * alpha;
    }

    if (accum.a >= 0.98) break;

    t += stepSize;
  }

  if (accum.a < 0.01) discard;
  gl_FragColor = accum;
}