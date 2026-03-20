varying vec3 vOrigin;
varying vec3 vDirection;

void main() {
  // World-space position of this vertex
  vec4 worldPos = modelMatrix * vec4(position, 1.0);

  // Ray origin = camera position in model (local) space
  vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;

  // Ray direction = from camera toward this vertex, in model space
  vDirection = position - vOrigin;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}