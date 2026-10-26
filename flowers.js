// Flowers are painted petal by petal in the fragment shader, like the hand-drawn flowers in teamLab's "Flowers and People".
// Four kinds: blossoms with stamens, gerberas with a dark eye, layered dahlias, and roses with a swirled heart.
// They rise in colonies of related colors, bud, bloom, and scatter loose petals that tumble away.
const seasonHexes = [
  ['#ffb3cc', '#ff6f9f', '#fff2f6', '#ffe04a', '#ff8fc0'],
  ['#4f63ff', '#9b5cff', '#c6d4ff', '#ffffff', '#ffcf33'],
  ['#ff2a14', '#ff7a00', '#ffc400', '#ff1f7a', '#ff4d4d'],
  ['#e8002f', '#fff6ee', '#ff9fbc', '#ff3d5e', '#ffd87a']
]
const flowersPerColony = 10, loosePetalsPerFlower = 6

const flowerVertexShader = `
uniform float time, cameraDistance;
uniform vec2 viewSize;
uniform vec3 seasonColors[20];
attribute vec4 colony, flower;
attribute vec2 part;
varying vec2 local, parallax;
varying vec3 petalColor, lightInFlower;
varying float species, look, open, shed, blur, fade, isLoosePetal;

float hash(float n) { return fract(sin(n) * 43758.5453); }
vec3 turnX(vec3 p, float angle) { return vec3(p.x, p.y * cos(angle) - p.z * sin(angle), p.y * sin(angle) + p.z * cos(angle)); }
vec3 turnY(vec3 p, float angle) { return vec3(p.x * cos(angle) + p.z * sin(angle), p.y, -p.x * sin(angle) + p.z * cos(angle)); }
vec3 turnZ(vec3 p, float angle) { return vec3(p.x * cos(angle) - p.y * sin(angle), p.x * sin(angle) + p.y * cos(angle), p.z); }

vec3 centerAt(float rise) {
  float y = rise * viewSize.y * 1.5 - viewSize.y * 0.25 + flower.y * 60.0;
  float x = colony.x * viewSize.x * 1.2 - viewSize.x * 0.1 + flower.x * 80.0
    + sin(y * 0.0035 + colony.y * 6.28) * 70.0 + sin(time * 0.15 + flower.w * 6.28) * 14.0;
  float stretch = (cameraDistance - flower.z) / cameraDistance;
  return vec3(viewSize * 0.5 + (vec2(x, y) - viewSize * 0.5) * stretch, flower.z);
}

void main() {
  float riseLifetime = 30.0 + colony.z * 16.0;
  float rise = fract((time + hash(flower.w * 17.0) * 3.0) / riseLifetime + colony.y);
  float lifetime = 14.0 + hash(flower.w * 23.0) * 10.0;
  float life = fract(time / lifetime + hash(flower.w * 29.0));
  species = floor(hash(flower.w * 7.3) * 4.0);
  look = flower.w;
  open = smoothstep(0.04, 0.32, life);
  shed = smoothstep(0.7, 0.92, life);
  blur = smoothstep(60.0, 400.0, abs(flower.z + 300.0)) * 0.3;

  float season = mod(floor((time - life * lifetime) / 80.0), 4.0);
  float pick = hash(flower.w * 3.1) < 0.7 ? colony.w : hash(flower.w * 5.9);
  petalColor = seasonColors[int(season * 5.0 + floor(pick * 4.99))];

  float radius = (22.0 + pow(hash(flower.w * 11.0), 2.0) * 40.0) * (species < 0.5 ? 0.75 : 1.0);
  float spin = flower.w * 40.0 + time * 0.08 * (hash(flower.w * 2.0) - 0.5);
  vec2 tilt = (vec2(hash(flower.w * 3.0), hash(flower.w * 4.0)) - 0.5) * 1.3 + sin(time * 0.4 + flower.w * 30.0) * 0.12;
  isLoosePetal = step(0.0, part.x);
  vec3 center, corner;
  if (isLoosePetal < 0.5) {
    local = position.xy * 1.9;
    fade = 1.0 - smoothstep(0.93, 1.0, life);
    center = centerAt(rise);
    corner = turnZ(vec3(local * radius * (0.35 + 0.65 * smoothstep(0.0, 0.3, life)), 0.0), spin);
    // The camera and the light, seen from the flower's own tilted frame, so raised layers can shift and cupped petals can catch light
    vec3 across = turnY(turnX(turnZ(vec3(1.0, 0.0, 0.0), spin), tilt.x), tilt.y);
    vec3 up = turnY(turnX(turnZ(vec3(0.0, 1.0, 0.0), spin), tilt.x), tilt.y);
    vec3 facing = turnY(turnX(vec3(0.0, 0.0, 1.0), tilt.x), tilt.y);
    vec3 toCamera = normalize(cameraPosition - center);
    vec3 cameraInFlower = vec3(dot(toCamera, across), dot(toCamera, up), dot(toCamera, facing));
    parallax = cameraInFlower.xy / max(cameraInFlower.z, 0.3);
    vec3 light = normalize(vec3(-0.5, 0.7, 0.6));
    lightInFlower = vec3(dot(light, across), dot(light, up), dot(light, facing));
  } else {
    float shedAt = mix(0.7, 0.92, part.y);
    float age = fract(life - shedAt) * lifetime;
    fade = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(0.0, 7.0, age));
    float direction = part.x * 2.39996 + spin;
    vec2 drift = vec2(cos(direction), sin(direction)) * (radius * 0.7 + age * 10.0)
      + vec2(18.0 + 10.0 * sin(time * 0.3 + part.y * 6.0), -14.0) * age
      + vec2(sin(age * 1.9 + part.y * 30.0), cos(age * 1.3 + part.y * 20.0)) * 12.0 * min(age, 1.0);
    center = centerAt(fract(rise - age / riseLifetime)) + vec3(drift, 0.0);
    local = position.xy * 1.4;
    float tumble = age * (2.0 + part.y * 3.0) + part.y * 6.0;
    corner = turnZ(vec3(position.x * max(abs(cos(tumble)), 0.25), position.y, 0.0) * radius * 0.45, direction + age * (part.y - 0.5) * 1.5);
    parallax = vec2(0.0);
    lightInFlower = vec3(0.0, 0.0, abs(cos(tumble)));
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(center + turnY(turnX(corner, tilt.x), tilt.y), 1.0);
}`

const flowerFragmentShader = `
varying vec2 local, parallax;
varying vec3 petalColor, lightInFlower;
varying float species, look, open, shed, blur, fade, isLoosePetal;

float hash(float n) { return fract(sin(n) * 43758.5453); }
vec2 turn(vec2 p, float angle) { return vec2(p.x * cos(angle) + p.y * sin(angle), -p.x * sin(angle) + p.y * cos(angle)); }

// One petal growing along +x from the origin. "along" reports how far out (x) and how far across (y) this pixel sits on it.
float petal(vec2 q, float reach, float width, float notch, float edge, out vec2 along) {
  float tipDip = notch * (1.0 - smoothstep(0.0, width * reach * 0.6, abs(q.y)));
  float t = q.x / (reach * (1.0 - tipDip));
  float widest = pow(clamp(t, 0.0, 1.0), 1.4) * 2.0 - 1.0;
  float halfWidth = width * reach * sqrt(max(1.0 - widest * widest, 0.0));
  along = vec2(t, abs(q.y) / max(halfWidth, 0.0001));
  return smoothstep(edge, -edge, abs(q.y) - halfWidth) * smoothstep(-edge, edge, q.x) * step(t, 1.0);
}

// Dark at the base where inner petals shade it, faint veins, light at the tip, a painted darker edge
vec3 shadePetal(vec3 color, vec2 along, float id, float lit) {
  float baseShadow = mix(0.5, 1.0, smoothstep(0.0, 0.6, along.x));
  float veins = 1.0 - 0.12 * (0.5 + 0.5 * cos(along.y * 10.0)) * smoothstep(0.1, 0.9, along.x);
  vec3 shaded = color * baseShadow * veins * (0.85 + 0.3 * hash(id)) * (0.65 + 0.55 * lit);
  return mix(shaded, vec3(1.0), smoothstep(0.5, 1.0, along.x) * 0.25) * (1.0 - smoothstep(0.75, 1.0, along.y) * 0.25);
}

// A ring of petals, each overlapping the next like a pinwheel. Shed petals drop out one by one.
// Petals curve up toward their tips by "cup", so each one catches the light differently as the flower tilts.
vec4 petalRing(vec2 p, float count, float angleOffset, float reach, float width, float notch, float cup, vec3 color, float edge, float layer) {
  float sector = 6.28318 / count;
  float angle = mod(atan(p.y, p.x) - angleOffset, 6.28318);
  float nearest = floor(angle / sector + 0.5);
  vec4 ring = vec4(0.0);
  for (int side = -1; side <= 1; side++) {
    float index = nearest + float(side);
    float id = mod(index, count) + layer * 37.0 + look * 113.0;
    if (hash(id) < shed) continue;
    float offset = angle - index * sector;
    vec2 along;
    float cover = petal(length(p) * vec2(cos(offset), sin(offset)), reach * (0.9 + 0.2 * hash(id + 5.0)), width, notch, edge, along);
    vec3 surface = normalize(vec3(-normalize(p + 0.0001) * cup * along.x, 1.0));
    ring = mix(ring, vec4(shadePetal(color, along, id, max(dot(surface, lightInFlower), 0.0)), 1.0), cover);
  }
  return ring;
}

void main() {
  int kind = int(species + 0.5);
  float edge = length(fwidth(local)) * 0.7 + blur;
  float r = length(local);
  vec4 paint = vec4(0.0);
  float glow;
  vec2 along;

  if (isLoosePetal > 0.5) {
    float bend = (hash(look * 9.0) - 0.5) * 0.6;
    float cover = petal(vec2(local.x + 1.0, local.y + bend * local.x * local.x), 2.0, kind == 0 || kind == 3 ? 0.4 : 0.22, kind == 0 ? 0.2 : 0.0, edge, along);
    paint = vec4(shadePetal(petalColor, along, look, lightInFlower.z), 1.0) * cover;
    glow = pow(smoothstep(1.35, 0.0, r), 2.0) * 0.35;
  } else {
    vec3 color = petalColor;

    if (kind != 0) {
      for (int leaf = 0; leaf < 2; leaf++) {
        float cover = petal(turn(local - parallax * 0.08, look * 20.0 + float(leaf) * 2.6), 1.7, 0.16, 0.0, edge, along);
        vec3 leafColor = mix(vec3(0.04, 0.15, 0.09) * (0.7 + 0.6 * along.x), vec3(0.12, 0.3, 0.16), smoothstep(0.12, 0.0, along.y) * 0.6);
        paint = mix(paint, vec4(leafColor * (0.5 + 0.7 * lightInFlower.z), 1.0), cover * 0.9);
      }
    }

    float layers = kind == 0 ? 1.0 : kind == 1 ? 2.0 : 3.0;
    for (int layer = 0; layer < 3; layer++) {
      float i = float(layer);
      if (i >= layers) break;
      float count = 5.0, width = 0.85, notch = 0.0, reach = 1.0 - i * 0.28, cup = 0.9 + i * 0.4, height = i * 0.18;
      vec3 layerColor = color * (1.0 - i * 0.12);
      if (kind == 0) { count = look < 0.5 ? 5.0 : 8.0; width = look < 0.5 ? 0.55 : 0.36; notch = look < 0.5 ? 0.22 : 0.1; reach = 1.0; cup = 0.5; layerColor = color; }
      if (kind == 1) { count = 16.0 + floor(look * 8.0); width = 0.15; notch = 0.05; reach = 1.0 - i * 0.2; cup = 0.3; height = i * 0.05; layerColor = color * (1.0 - i * 0.15); }
      if (kind == 2) { count = 13.0 - i * 2.0; width = 0.22; reach = 1.0 - i * 0.26; cup = 0.6 + i * 0.3; height = i * 0.14; layerColor = mix(color, vec3(1.0), i * 0.18); }
      float layerOpen = smoothstep(i * 0.12, 0.55 + i * 0.12, open);
      reach *= mix(0.3, 1.0, layerOpen);
      vec4 ring = petalRing(local + parallax * height, count, i * 3.14159 / count + look * 6.28 + (1.0 - layerOpen) * 1.2, reach, width * mix(0.6, 1.0, layerOpen), notch, cup, layerColor, edge, i);
      paint = ring + paint * (1.0 - ring.a);
    }

    vec2 heartPoint = local + parallax * (kind == 0 ? 0.2 : kind == 1 ? 0.08 : 0.45);
    r = length(heartPoint);
    float heart = r / mix(0.5, 1.0, open);
    float angle = atan(heartPoint.y, heartPoint.x);
    if (kind == 0) {
      float filamentGap = abs(fract(angle / 6.28318 * 12.0) - 0.5) * 6.28318 / 12.0 * r;
      paint = mix(paint, vec4(1.0, 0.92, 0.95, 1.0), smoothstep(edge + 0.012, 0.0, filamentGap) * step(heart, 0.34) * 0.8);
      paint = mix(paint, vec4(1.0, 0.82, 0.25, 1.0), smoothstep(0.05 + edge, 0.03, length(vec2(filamentGap, heart - 0.34))));
      paint = mix(paint, vec4(0.85, 0.75, 0.3, 1.0), smoothstep(0.1 + edge, 0.1 - edge, heart));
    } else if (kind == 1) {
      float pollenGrain = 0.8 + 0.2 * sin(angle * 40.0) * sin(heart * 60.0);
      paint = mix(paint, vec4(mix(vec3(1.0, 0.72, 0.1), color, 0.25) * pollenGrain, 1.0), smoothstep(0.3 + edge, 0.3 - edge, heart));
      paint = mix(paint, vec4(0.18, 0.07, 0.03, 1.0), smoothstep(0.13 + edge, 0.13 - edge, heart));
    } else if (kind == 2) {
      paint = mix(paint, vec4(mix(color, vec3(1.0, 0.85, 0.4), 0.5), 1.0), smoothstep(0.14 + edge, 0.14 - edge, heart));
    } else {
      float swirl = 0.5 + 0.5 * sin(angle * 2.0 + log(max(heart, 0.01)) * 7.0 + look * 20.0);
      paint = mix(paint, vec4(color * mix(0.6, 1.0, swirl), 1.0), smoothstep(0.3 + edge, 0.3 - edge, heart) * open);
    }
    glow = pow(smoothstep(1.85, 0.3, length(local)), 1.5) * (0.2 + 0.35 * open) * (1.0 - 0.7 * shed);
  }
  // Glow is added light (alpha 0) and the painted flower covers what is behind it
  gl_FragColor = vec4(paint.rgb + petalColor * glow * (1.0 - paint.a), paint.a) * fade;
}`

// Tiny gold pollen sparks, like the dots drifting between teamLab's flowers
const moteVertexShader = `
uniform float time, cameraDistance, pixelRatio;
uniform vec2 viewSize;
attribute vec4 seed;
varying float brightness;
void main() {
  float rise = fract(time * (0.008 + seed.w * 0.016) + seed.z);
  vec2 screen = vec2(seed.x * viewSize.x * 1.4 - viewSize.x * 0.2 + sin(time * 0.3 + seed.z * 40.0) * 30.0, rise * viewSize.y * 1.6 - viewSize.y * 0.3);
  float stretch = (cameraDistance - seed.y) / cameraDistance;
  vec4 viewPosition = modelViewMatrix * vec4(viewSize * 0.5 + (screen - viewSize * 0.5) * stretch, seed.y, 1.0);
  brightness = 0.6 + 0.4 * sin(time * (1.0 + seed.w * 2.0) + seed.z * 50.0);
  gl_PointSize = (3.0 + seed.w * 5.0) * pixelRatio * cameraDistance / -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}`

// The falloff reaches exactly zero inside the point, so overlapping sparks never show square edges
const moteFragmentShader = `
varying float brightness;
void main() {
  float glow = pow(max(1.0 - length(gl_PointCoord - 0.5) * 2.0, 0.0), 2.5);
  gl_FragColor = vec4(vec3(1.0, 0.78, 0.35) * glow * brightness, 1.0);
}`

function nearColonyCenter() {
  return Math.random() + Math.random() + Math.random() - 1.5
}

function pollenMotes(THREE, count, uniforms) {
  const geometry = new THREE.BufferGeometry()
  const seeds = Array.from({ length: count }, () => [Math.random(), -200 - Math.random() * 1100, Math.random(), Math.random()])
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(seeds.flat()), 4))
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: moteVertexShader, fragmentShader: moteFragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  return new THREE.Points(geometry, material)
}

export function createFlowerField(THREE, { flowerCount, moteCount, width, height, cameraDistance, pixelRatio }) {
  const uniforms = {
    time: { value: 0 },
    cameraDistance: { value: cameraDistance },
    pixelRatio: { value: pixelRatio },
    viewSize: { value: new THREE.Vector2(width, height) },
    seasonColors: { value: seasonHexes.flat().map(hex => new THREE.Color(hex).convertLinearToSRGB()) }
  }
  const parts = []
  for (let colonyIndex = 0; colonyIndex < flowerCount / flowersPerColony; colonyIndex++) {
    const colony = [Math.random(), Math.random(), Math.random(), Math.random()]
    const colonyDepth = -180 - Math.random() * 560
    for (let flowerIndex = 0; flowerIndex < flowersPerColony; flowerIndex++) {
      const flower = [nearColonyCenter(), nearColonyCenter(), colonyDepth + (Math.random() - 0.5) * 100, Math.random()]
      for (let petal = -1; petal < loosePetalsPerFlower; petal++) parts.push({ colony, flower, part: [petal, Math.random()] })
    }
  }
  // Transparent flowers have to be drawn far to near
  parts.sort((a, b) => a.flower[2] - b.flower[2])

  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2))
  geometry.instanceCount = parts.length
  for (const [name, size] of [['colony', 4], ['flower', 4], ['part', 2]]) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(parts.flatMap(item => item[name])), size))
  }
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: flowerVertexShader, fragmentShader: flowerFragmentShader, transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide })
  const field = new THREE.Group().add(new THREE.Mesh(geometry, material), pollenMotes(THREE, moteCount, uniforms))
  field.traverse(object => object.frustumCulled = false)
  return { field, uniforms }
}
