const columns = 60, rows = 40
const relaxIterations = 12, gravity = 0.2, damping = 0.99, tearRatio = 2.5
const pointer = { x: 0, y: 0, isDown: false }
const constraints = [], rightLinks = [], downLinks = []
let dragStart = null, ripStarted = false
let positions, previousPositions, isPinned, grabbedIndex = -1

function updatePointer(event) {
  pointer.x = event.clientX
  pointer.y = innerHeight - event.clientY
}

function grabNearestParticle() {
  let nearestDistance = Infinity
  for (let i = 0; i < columns * rows; i++) {
    const distance = Math.hypot(positions[i * 3] - pointer.x, positions[i * 3 + 1] - pointer.y)
    if (distance < nearestDistance) { nearestDistance = distance; grabbedIndex = i }
  }
  isPinned[grabbedIndex] = 1
}

function releaseParticle() {
  pointer.isDown = false
  dragStart = null
  if (grabbedIndex >= 0) isPinned[grabbedIndex] = 0
  grabbedIndex = -1
}

function linkParticles(a, b) {
  const restLength = Math.hypot(positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1])
  constraints.push({ a, b, restLength, isBroken: false })
  return constraints.at(-1)
}

function simulateCloth() {
  for (let i = 0; i < columns * rows; i++) {
    if (isPinned[i]) continue
    const x = i * 3, y = i * 3 + 1
    const velocityX = (positions[x] - previousPositions[x]) * damping
    const velocityY = (positions[y] - previousPositions[y]) * damping - gravity
    previousPositions.set([positions[x], positions[y]], x)
    positions.set([positions[x] + velocityX, positions[y] + velocityY], x)
  }
  if (grabbedIndex >= 0) positions.set([pointer.x, pointer.y], grabbedIndex * 3)
  for (let iteration = 0; iteration < relaxIterations; iteration++) {
    for (const link of constraints) {
      if (link.isBroken) continue
      const ax = link.a * 3, bx = link.b * 3
      const deltaX = positions[bx] - positions[ax], deltaY = positions[bx + 1] - positions[ax + 1]
      const distance = Math.hypot(deltaX, deltaY)
      if (distance > link.restLength * tearRatio) { link.isBroken = true; continue }
      const weightA = 1 - isPinned[link.a], weightB = 1 - isPinned[link.b]
      const correction = (distance - link.restLength) / distance / (weightA + weightB || 1)
      positions[ax] += deltaX * correction * weightA
      positions[ax + 1] += deltaY * correction * weightA
      positions[bx] -= deltaX * correction * weightB
      positions[bx + 1] -= deltaY * correction * weightB
    }
  }
}

function visibleQuadIndices() {
  const quadIndices = []
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const topLeft = row * columns + column, bottomLeft = topLeft + columns
      if (rightLinks[topLeft].isBroken || rightLinks[bottomLeft].isBroken || downLinks[topLeft].isBroken || downLinks[topLeft + 1].isBroken) continue
      quadIndices.push(topLeft, bottomLeft, topLeft + 1, topLeft + 1, bottomLeft, bottomLeft + 1)
    }
  }
  return quadIndices
}

function moveMetaballs(metaballs, seconds) {
  metaballs.reset()
  for (let ball = 0; ball < 7; ball++) {
    const angle = seconds * (0.4 + ball * 0.07) + ball * 0.9
    metaballs.addBall(0.5 + 0.3 * Math.cos(angle), 0.5 + 0.3 * Math.sin(angle * 1.3), 0.5 + 0.3 * Math.sin(angle * 0.7), 0.8, 12)
  }
  metaballs.rotation.y = seconds * 0.2
  metaballs.update()
}

async function startRip() {
  ripStarted = true
  const [THREE, { MarchingCubes }, { default: html2canvas }] = await Promise.all([
    import('three'), import('three/addons/objects/MarchingCubes.js'), import('html2canvas')
  ])
  const pixelRatio = Math.min(devicePixelRatio, 2)
  // Safari never loads lazy images inside html2canvas's offscreen clone, so the snapshot hangs forever
  document.querySelectorAll('img').forEach(image => image.loading = 'eager')
  const snapshot = await html2canvas(document.body, { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scale: pixelRatio })
  const width = innerWidth, height = innerHeight

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height)
  renderer.domElement.style.cssText += 'position:fixed;top:0;left:0;z-index:9999;touch-action:none;visibility:visible'
  document.body.append(renderer.domElement)
  document.body.style.visibility = 'hidden'

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#2a0a3d')
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -5000, 5000)
  const texture = new THREE.CanvasTexture(snapshot)
  texture.colorSpace = THREE.SRGBColorSpace
  const geometry = new THREE.PlaneGeometry(width, height, columns - 1, rows - 1).translate(width / 2, height / 2, 0)
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array((columns - 1) * (rows - 1) * 6), 1))
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })))

  positions = geometry.attributes.position.array
  previousPositions = positions.slice()
  isPinned = new Uint8Array(columns * rows).fill(1, 0, columns)
  for (let i = 0; i < columns * rows; i++) {
    if (i % columns < columns - 1) rightLinks[i] = linkParticles(i, i + 1)
    if (i < columns * (rows - 1)) downLinks[i] = linkParticles(i, i + columns)
  }
  if (pointer.isDown) grabNearestParticle()

  const resolution = matchMedia('(pointer: coarse)').matches ? 28 : 48
  const metaballs = new MarchingCubes(resolution, new THREE.MeshNormalMaterial(), false, false, 100000)
  metaballs.position.set(width / 2, height / 2, -2000)
  metaballs.scale.setScalar(Math.max(width, height))
  scene.add(metaballs)

  renderer.setAnimationLoop(time => {
    simulateCloth()
    const quadIndices = visibleQuadIndices()
    geometry.index.array.set(quadIndices)
    geometry.index.needsUpdate = true
    geometry.setDrawRange(0, quadIndices.length)
    geometry.attributes.position.needsUpdate = true
    moveMetaballs(metaballs, time / 1000)
    renderer.render(scene, camera)
  })
}

addEventListener('pointerdown', event => {
  pointer.isDown = true
  updatePointer(event)
  if (ripStarted) return positions && grabNearestParticle()
  if (event.target.closest('a, video, button')) return
  dragStart = { x: pointer.x, y: pointer.y }
  if (event.pointerType !== 'mouse' && event.target.closest('#peel')) startRip()
})

addEventListener('pointermove', event => {
  updatePointer(event)
  const draggedFar = dragStart && Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) > 30
  if (!ripStarted && event.pointerType === 'mouse' && draggedFar) startRip()
})

addEventListener('pointerup', releaseParticle)
addEventListener('pointercancel', releaseParticle)
