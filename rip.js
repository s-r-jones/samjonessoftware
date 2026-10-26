const columns = 100, rows = 66
const relaxIterations = 12, gravity = 0.2, damping = 0.99, tearRatio = 2.5
const ballStrength = 1, ballSubtract = 12, burstAfterSeconds = 5
const pointer = { x: 0, y: 0, isDown: false }
const tilt = { x: 0, y: 0 }
const constraints = [], rightLinks = [], downLinks = []
let dragStart = null, ripStarted = false, askedForGyro = false
let positions, previousPositions, isPinned, grabbedIndex = -1
let leaderPoint = [0.5, 0.5, 0.5]

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
  if (ripStarted && !askedForGyro && window.DeviceOrientationEvent?.requestPermission) {
    askedForGyro = true
    DeviceOrientationEvent.requestPermission()
  }
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

function bubbleCloth(centerX, centerY, bubbleSeconds) {
  if (bubbleSeconds < 0) return
  const bubbleRadius = 30 + bubbleSeconds * 15
  const push = Math.sin(bubbleSeconds * 9) * 1.5 + bubbleSeconds * 0.4
  for (let i = 0; i < columns * rows; i++) {
    if (isPinned[i]) continue
    const deltaX = positions[i * 3] - centerX, deltaY = positions[i * 3 + 1] - centerY
    const distance = Math.hypot(deltaX, deltaY)
    if (distance === 0 || distance > bubbleRadius) continue
    const falloff = 1 - distance / bubbleRadius
    positions[i * 3] += deltaX / distance * push * falloff
    positions[i * 3 + 1] += deltaY / distance * push * falloff
  }
  const ripRadius = Math.min((bubbleSeconds - 2) * 12, 220)
  if (ripRadius <= 0) return
  for (const link of constraints) {
    const middleX = (positions[link.a * 3] + positions[link.b * 3]) / 2 - centerX
    const middleY = (positions[link.a * 3 + 1] + positions[link.b * 3 + 1]) / 2 - centerY
    const raggedRadius = ripRadius * (0.75 + 0.25 * Math.sin(Math.atan2(middleY, middleX) * 7))
    if (Math.hypot(middleX, middleY) < raggedRadius) link.isBroken = true
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
  const tapPoint = [0.5 + 0.3 * (pointer.x / innerWidth * 2 - 1), 0.5 + 0.3 * (pointer.y / innerHeight * 2 - 1), 0.5]
  const leaderTarget = pointer.isDown ? tapPoint : [0.5, 0.5, 0.5]
  leaderPoint = leaderPoint.map((value, axis) => value + (leaderTarget[axis] - value) * 0.08)
  metaballs.reset()
  metaballs.addBall(...leaderPoint, ballStrength * 1.5, ballSubtract)
  for (let ball = 1; ball < 7; ball++) {
    const angle = seconds * (0.4 + ball * 0.07) + ball * 0.9
    metaballs.addBall(0.5 + 0.3 * Math.cos(angle), 0.5 + 0.3 * Math.sin(angle * 1.3), 0.5 + 0.3 * Math.sin(angle * 0.7), ballStrength, ballSubtract)
  }
  metaballs.update()
}

async function startRip() {
  ripStarted = true
  const [THREE, { MarchingCubes }, { RoomEnvironment }, { default: html2canvas }] = await Promise.all([
    import('three'), import('three/addons/objects/MarchingCubes.js'),
    import('three/addons/environments/RoomEnvironment.js'), import('html2canvas')
  ])
  const pixelRatio = Math.min(devicePixelRatio, 2)
  // Safari never loads lazy images inside html2canvas's offscreen clone, so the snapshot hangs forever
  document.querySelectorAll('img').forEach(image => image.loading = 'eager')
  const snapshot = await html2canvas(document.body, { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scale: pixelRatio })
  const width = innerWidth, height = innerHeight

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height)
  renderer.autoClear = false
  renderer.domElement.style.cssText += 'position:fixed;top:0;left:0;z-index:9999;touch-action:none;visibility:visible'
  document.body.append(renderer.domElement)
  document.body.style.visibility = 'hidden'

  const world = new THREE.Scene()
  world.background = new THREE.Color('#14051f')
  world.fog = new THREE.Fog('#14051f', 700, 2600)
  world.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture
  const pinkLight = new THREE.DirectionalLight('#ff3fd2', 3)
  pinkLight.position.set(-1, 1, 1)
  const cyanLight = new THREE.DirectionalLight('#3ff5ff', 2)
  cyanLight.position.set(1, -0.5, 1)
  const floorGrid = new THREE.GridHelper(6000, 60, '#ff3fd2', '#6b2fa8')
  floorGrid.position.y = -350
  world.add(pinkLight, cyanLight, floorGrid)
  const worldCamera = new THREE.PerspectiveCamera(50, width / height, 1, 6000)

  const resolution = matchMedia('(pointer: coarse)').matches ? 28 : 48
  const chrome = new THREE.MeshPhysicalMaterial({ color: '#b48cff', metalness: 0.6, roughness: 0.15, clearcoat: 1, iridescence: 1 })
  const metaballs = new MarchingCubes(resolution, chrome, false, false, 100000)
  metaballs.scale.setScalar(400)
  world.add(metaballs)

  const cloth = new THREE.Scene()
  const clothCamera = new THREE.OrthographicCamera(0, width, height, 0, -1, 1)
  const texture = new THREE.CanvasTexture(snapshot)
  texture.colorSpace = THREE.SRGBColorSpace
  const geometry = new THREE.PlaneGeometry(width, height, columns - 1, rows - 1).translate(width / 2, height / 2, 0)
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array((columns - 1) * (rows - 1) * 6), 1))
  cloth.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })))

  positions = geometry.attributes.position.array
  previousPositions = positions.slice()
  isPinned = new Uint8Array(columns * rows).fill(1, 0, columns)
  for (let i = 0; i < columns * rows; i++) {
    if (i % columns < columns - 1) rightLinks[i] = linkParticles(i, i + 1)
    if (i < columns * (rows - 1)) downLinks[i] = linkParticles(i, i + columns)
  }
  if (pointer.isDown) grabNearestParticle()

  renderer.setAnimationLoop(time => {
    const burstSeconds = time / 1000 - burstAfterSeconds
    bubbleCloth(width / 2, height / 2, burstSeconds)
    bubbleCloth(width * 0.42, height * 0.58, burstSeconds - 1.5)
    bubbleCloth(width * 0.57, height * 0.44, burstSeconds - 3)
    simulateCloth()
    const quadIndices = visibleQuadIndices()
    geometry.index.array.set(quadIndices)
    geometry.index.needsUpdate = true
    geometry.setDrawRange(0, quadIndices.length)
    geometry.attributes.position.needsUpdate = true

    moveMetaballs(metaballs, time / 1000)
    worldCamera.position.x += (tilt.x - worldCamera.position.x) * 0.05
    worldCamera.position.y += (150 + tilt.y - worldCamera.position.y) * 0.05
    worldCamera.position.z = 1000
    worldCamera.lookAt(0, 0, 0)

    renderer.clear()
    renderer.render(world, worldCamera)
    renderer.clearDepth()
    renderer.render(cloth, clothCamera)
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
  if (event.pointerType === 'mouse') {
    tilt.x = (pointer.x / innerWidth - 0.5) * 400
    tilt.y = (pointer.y / innerHeight - 0.5) * 300
  }
  const draggedFar = dragStart && Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) > 30
  if (!ripStarted && event.pointerType === 'mouse' && draggedFar) startRip()
})

addEventListener('deviceorientation', event => {
  if (event.gamma === null) return
  tilt.x = event.gamma * 6
  tilt.y = (event.beta - 45) * -6
})

setTimeout(() => ripStarted || startRip(), burstAfterSeconds * 1000)
addEventListener('pointerup', releaseParticle)
addEventListener('pointercancel', releaseParticle)
