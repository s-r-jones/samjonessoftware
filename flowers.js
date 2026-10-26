// Every flower, petal and drifting mote is animated on the GPU from its own random seed, so each one lives a different life.
// Flowers bud, bloom, then shed their petals into the wind, like teamLab's "Flowers and People".
// A flower takes the colors of the season it was born in, so the field turns over gradually.
const seasonHexes = [
  ['#ffc4d6', '#ff9ebb', '#ffffff', '#ffe3ec', '#ffb3c8'],
  ['#4b4bd8', '#7a5cff', '#8fb4ff', '#f4f6ff', '#5b8cff'],
  ['#e8102e', '#ff5a1f', '#ffc21a', '#b0002a', '#ff8a3d'],
  ['#d7003a', '#ffffff', '#ffd1dc', '#c2002f', '#ffffff']
]
const partsPerFlower = 16

const flowerLifeGlsl = `
uniform float time, cameraDistance, pixelRatio;
uniform vec2 viewSize;
uniform vec3 seasonColors[20];
attribute vec4 seed;

float lifetimeOf(vec4 seed) { return 14.0 + seed.w * 10.0; }
float lifeOf(vec4 seed) { return fract(time / lifetimeOf(seed) + seed.z); }
float sizeOf(vec4 seed) { return seed.w > 0.8 ? 14.0 + fract(seed.x * 37.0) * 12.0 : 22.0 + fract(seed.z * 53.1) * 30.0; }

vec3 centerOf(vec4 seed, float life) {
  float screenY = life * viewSize.y * 1.4 - viewSize.y * 0.2;
  float screenX = seed.x * viewSize.x * 1.2 - viewSize.x * 0.1
    + sin(screenY * 0.004 + seed.z * 6.28 + time * 0.2) * 70.0
    + sin(screenY * 0.013 + seed.w * 6.28) * 20.0;
  float stretch = (cameraDistance - seed.y) / cameraDistance;
  return vec3(viewSize * 0.5 + (vec2(screenX, screenY) - viewSize * 0.5) * stretch, seed.y);
}

vec3 seasonColor(float moment, float pick) {
  float season = mod(floor(moment / 60.0), 4.0);
  return seasonColors[int(season * 5.0 + floor(pick * 4.99))];
}

vec3 turnX(vec3 p, float angle) { return vec3(p.x, p.y * cos(angle) - p.z * sin(angle), p.y * sin(angle) + p.z * cos(angle)); }
vec3 turnY(vec3 p, float angle) { return vec3(p.x * cos(angle) + p.z * sin(angle), p.y, -p.x * sin(angle) + p.z * cos(angle)); }
vec3 turnZ(vec3 p, float angle) { return vec3(p.x * cos(angle) - p.y * sin(angle), p.x * sin(angle) + p.y * cos(angle), p.z); }
`

const petalVertexShader = flowerLifeGlsl + `
attribute vec2 part;
varying vec3 petalColor, viewNormal;
varying float alongPetal;

void main() {
  float life = lifeOf(seed);
  float isRose = step(seed.w, 0.5), isBlossom = step(0.8, seed.w);
  float petalCount = isRose * 13.0 + isBlossom * 5.0 + (1.0 - isRose - isBlossom) * 9.0;
  float isLeaf = step(petalCount, part.x) * (1.0 - isBlossom);
  float isUsed = step(part.x, petalCount + 2.5 - isBlossom * 3.0);
  float outerness = part.x / (petalCount - 1.0);

  float open = smoothstep(0.02, 0.4, life);
  float shed = smoothstep(0.55 + part.y * 0.25, 1.0, life);
  float roseOpening = 0.12 + open * (0.15 + 1.3 * outerness);
  float flatOpening = 0.3 + open * (isBlossom * 1.25 + (1.0 - isBlossom) * (1.05 + 0.3 * outerness));
  float openAngle = mix(mix(flatOpening, roseOpening, isRose), 1.75, isLeaf);
  float spiralStep = mix(6.2832 / petalCount, 2.39996, isRose);
  float azimuth = mix(part.x * spiralStep, part.x * 2.1 + 0.5, isLeaf) + seed.z * 6.28 + time * 0.1;
  float petalScale = mix(1.0, 0.45 + 0.6 * outerness, isRose);
  vec3 shape = position * mix(vec3(petalScale * 0.9, petalScale, petalScale), vec3(0.45, 1.4, 0.45), isLeaf);
  float flutter = shed * (sin(time * 3.0 + part.y * 20.0) * 1.5 + part.y * 6.0);
  vec2 tilt = vec2((fract(seed.x * 17.3) - 0.5) * 1.4 + sin(time * 0.6 + seed.z * 20.0) * 0.15, (fract(seed.z * 29.1) - 0.5) * 1.4);

  vec3 placed = turnZ(turnX(turnY(turnX(turnZ(shape, flutter), openAngle), azimuth), 1.5708 + tilt.x), tilt.y);
  vec3 bent = turnZ(turnX(turnY(turnX(turnZ(normal, flutter), openAngle), azimuth), 1.5708 + tilt.x), tilt.y);
  vec3 outward = turnZ(turnX(turnY(vec3(0.0, shed * 1.5, 0.05 + shed * 2.5), azimuth), 1.5708 + tilt.x), tilt.y);
  vec3 wind = shed * vec3(sin(time * 0.7 + part.y * 30.0) * 60.0, shed * 160.0, 0.0);
  float flowerScale = sizeOf(seed) * (0.35 + 0.65 * open) * (1.0 - smoothstep(0.88, 1.0, life)) * isUsed;
  vec3 world = centerOf(seed, life) + (placed + outward) * flowerScale + wind;

  vec3 color = seasonColor(time - life * lifetimeOf(seed), fract(seed.z * 91.7));
  petalColor = mix(mix(color, vec3(1.0), (1.0 - outerness) * 0.35 * isRose) * (0.85 + 0.3 * part.y), vec3(0.04, 0.22, 0.09), isLeaf);
  viewNormal = mat3(viewMatrix) * bent;
  alongPetal = uv.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

// Thin petals glow where light passes through their edges, and brighten toward the base
const petalFragmentShader = `
varying vec3 petalColor, viewNormal;
varying float alongPetal;
void main() {
  float facing = abs(normalize(viewNormal).z);
  float throughLight = pow(1.0 - facing, 3.0);
  vec3 color = petalColor * (0.55 + 0.45 * facing) * (1.15 - 0.35 * alongPetal) + petalColor * throughLight * 0.9 + (1.0 - alongPetal) * 0.12;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`

const haloVertexShader = flowerLifeGlsl + `
varying vec3 glowColor;
void main() {
  float life = lifeOf(seed);
  float bloom = smoothstep(0.1, 0.4, life) * (1.0 - smoothstep(0.55, 0.8, life));
  glowColor = seasonColor(time - life * lifetimeOf(seed), fract(seed.z * 91.7)) * bloom * 0.3;
  vec4 viewPosition = viewMatrix * vec4(centerOf(seed, life), 1.0);
  gl_PointSize = sizeOf(seed) * 5.0 * pixelRatio * cameraDistance / -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}`

const moteVertexShader = flowerLifeGlsl + `
varying vec3 glowColor;
void main() {
  float rise = fract(time * (0.01 + seed.w * 0.02) + seed.z);
  vec2 screen = vec2(seed.x * viewSize.x * 1.4 - viewSize.x * 0.2 + sin(time * 0.3 + seed.z * 40.0) * 40.0, rise * viewSize.y * 1.6 - viewSize.y * 0.3);
  float stretch = (cameraDistance - seed.y) / cameraDistance;
  glowColor = seasonColor(time, seed.w) * 0.8;
  vec4 viewPosition = viewMatrix * vec4(viewSize * 0.5 + (screen - viewSize * 0.5) * stretch, seed.y, 1.0);
  gl_PointSize = (6.0 + seed.w * 6.0) * pixelRatio * cameraDistance / -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}`

// The falloff reaches exactly zero inside the point, so overlapping glows never show square edges
const softGlowFragmentShader = `
varying vec3 glowColor;
void main() {
  float glow = pow(max(1.0 - length(gl_PointCoord - 0.5) * 2.0, 0.0), 2.0);
  gl_FragColor = vec4(glowColor * glow, 1.0);
  #include <colorspace_fragment>
}`

function cuppedPetal(THREE) {
  const petal = new THREE.PlaneGeometry(1, 1, 2, 4).translate(0, 0.5, 0)
  for (let i = 0; i < petal.attributes.position.count; i++) {
    const x = petal.attributes.position.getX(i), y = petal.attributes.position.getY(i)
    const width = 0.1 + 0.9 * Math.sin(Math.PI * Math.min(y * 1.1, 1))
    petal.attributes.position.setXYZ(i, x * width, y, -x * x * 0.8 - y * y * 0.3)
  }
  petal.computeVertexNormals()
  return petal
}

function randomSeeds(count, repeatEach, nearest, farthest) {
  const seeds = new Float32Array(count * repeatEach * 4)
  for (let item = 0; item < count; item++) {
    const itemSeed = [Math.random(), -nearest - Math.random() * (farthest - nearest), Math.random(), Math.random()]
    for (let copy = 0; copy < repeatEach; copy++) seeds.set(itemSeed, (item * repeatEach + copy) * 4)
  }
  return seeds
}

function glowPoints(THREE, count, vertexShader, uniforms, nearest, farthest) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(randomSeeds(count, 1, nearest, farthest), 4))
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: softGlowFragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  return new THREE.Points(geometry, material)
}

export function createFlowerField(THREE, { flowerCount, moteCount, width, height, cameraDistance, pixelRatio }) {
  const uniforms = {
    time: { value: 0 },
    cameraDistance: { value: cameraDistance },
    pixelRatio: { value: pixelRatio },
    viewSize: { value: new THREE.Vector2(width, height) },
    seasonColors: { value: seasonHexes.flat().map(hex => new THREE.Color(hex)) }
  }
  const geometry = new THREE.InstancedBufferGeometry().copy(cuppedPetal(THREE))
  geometry.instanceCount = flowerCount * partsPerFlower
  geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(randomSeeds(flowerCount, partsPerFlower, 150, 650), 4))
  const parts = new Float32Array(flowerCount * partsPerFlower * 2)
  for (let i = 0; i < flowerCount * partsPerFlower; i++) parts.set([i % partsPerFlower, Math.random()], i * 2)
  geometry.setAttribute('part', new THREE.InstancedBufferAttribute(parts, 2))
  const petals = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: petalVertexShader, fragmentShader: petalFragmentShader, side: THREE.DoubleSide }))
  const halos = glowPoints(THREE, flowerCount, haloVertexShader, uniforms, 150, 650)
  const oneSeedPerFlower = geometry.attributes.seed.array.filter((_, index) => Math.floor(index / 4) % partsPerFlower === 0)
  halos.geometry.setAttribute('seed', new THREE.BufferAttribute(oneSeedPerFlower, 4))
  const motes = glowPoints(THREE, moteCount, moteVertexShader, uniforms, 200, 1300)
  const field = new THREE.Group().add(petals, halos, motes)
  field.traverse(object => object.frustumCulled = false)
  return { field, uniforms }
}
