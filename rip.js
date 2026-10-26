const isTouchDevice = matchMedia('(pointer: coarse)').matches
const urlSettings = new URLSearchParams(location.search)
const setting = (name, fallback) => Number(urlSettings.get(name) ?? fallback)
const columns = setting('columns', isTouchDevice ? 90 : 180)
const relaxIterations = setting('iterations', 4), tearRatio = setting('tear', 1.6), punctureDepth = setting('puncture', 0.5)
const burstAfterSeconds = setting('burst', 30), ballStrength = setting('ball', 0.6)
const gravity = 0.04, damping = 0.98, ballSubtract = 30, ballIsolation = 80
const grabRadius = 30, pullTowardViewer = 60
const pointer = { x: 0, y: 0, isDown: false }
const tilt = { x: 0, y: 0 }
const rightLinks = [], downLinks = [], diagonalLinks = []
let linkStart, linkEnd, linkRestLength, linkIsBroken, linkCount = 0
let dragStart = null, ripStarted = false, askedForGyro = false
let rows, positions, previousPositions, isPinned, isPunctured, grabbedPatch = []
let leader = { x: innerWidth / 2, y: innerHeight / 2 }

function updatePointer(event) {
  pointer.x = event.clientX
  pointer.y = innerHeight - event.clientY
}

function grabClothPatch() {
  grabbedPatch = []
  for (let i = 0; i < columns * rows; i++) {
    if (isPinned[i]) continue
    const offsetX = positions[i * 3] - pointer.x, offsetY = positions[i * 3 + 1] - pointer.y
    if (offsetX * offsetX + offsetY * offsetY > grabRadius * grabRadius) continue
    grabbedPatch.push({ index: i, offsetX, offsetY })
    isPinned[i] = 1
  }
}

function releaseParticle() {
  pointer.isDown = false
  dragStart = null
  for (const grabbed of grabbedPatch) isPinned[grabbed.index] = 0
  grabbedPatch = []
  if (ripStarted && !askedForGyro && window.DeviceOrientationEvent?.requestPermission) {
    askedForGyro = true
    DeviceOrientationEvent.requestPermission()
  }
}

function linkParticles(a, b) {
  linkStart[linkCount] = a
  linkEnd[linkCount] = b
  linkRestLength[linkCount] = Math.hypot(positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1])
  return linkCount++
}

function simulateCloth() {
  for (let i = 0; i < columns * rows; i++) {
    if (isPinned[i]) continue
    for (let axis = 0; axis < 3; axis++) {
      const index = i * 3 + axis
      const velocity = (positions[index] - previousPositions[index]) * damping
      previousPositions[index] = positions[index]
      positions[index] += velocity
    }
    positions[i * 3 + 1] -= gravity
  }
  for (const grabbed of grabbedPatch) {
    positions.set([pointer.x + grabbed.offsetX, pointer.y + grabbed.offsetY, pullTowardViewer], grabbed.index * 3)
  }
  for (let iteration = 0; iteration < relaxIterations; iteration++) {
    for (let link = 0; link < linkCount; link++) {
      if (linkIsBroken[link]) continue
      const start = linkStart[link], end = linkEnd[link]
      if (isPunctured[start] || isPunctured[end]) { linkIsBroken[link] = 1; continue }
      const a = start * 3, b = end * 3
      const deltaX = positions[b] - positions[a], deltaY = positions[b + 1] - positions[a + 1], deltaZ = positions[b + 2] - positions[a + 2]
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)
      if (distance > linkRestLength[link] * tearRatio) { linkIsBroken[link] = 1; continue }
      const weightA = 1 - isPinned[start], weightB = 1 - isPinned[end]
      const correction = (distance - linkRestLength[link]) / distance / (weightA + weightB || 1)
      positions[a] += deltaX * correction * weightA
      positions[a + 1] += deltaY * correction * weightA
      positions[a + 2] += deltaZ * correction * weightA
      positions[b] -= deltaX * correction * weightB
      positions[b + 1] -= deltaY * correction * weightB
      positions[b + 2] -= deltaZ * correction * weightB
    }
  }
}

function pushClothOutOfBall(ball, radius) {
  for (let i = 0; i < columns * rows; i++) {
    if (isPinned[i]) continue
    const deltaX = positions[i * 3] - ball.x, deltaY = positions[i * 3 + 1] - ball.y, deltaZ = positions[i * 3 + 2] - ball.z
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)
    if (distance === 0 || distance >= radius) continue
    const pushOut = radius / distance
    positions.set([ball.x + deltaX * pushOut, ball.y + deltaY * pushOut, ball.z + deltaZ * pushOut], i * 3)
    if (positions[i * 3 + 2] > radius * punctureDepth) isPunctured[i] = 1
  }
}

function writeVisibleTriangles(triangleIndices) {
  let count = 0
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const topLeft = row * columns + column, bottomLeft = topLeft + columns, topRight = topLeft + 1
      if (linkIsBroken[diagonalLinks[topLeft]]) continue
      if (!linkIsBroken[downLinks[topLeft]] && !linkIsBroken[rightLinks[topLeft]]) {
        triangleIndices.set([topLeft, bottomLeft, topRight], count)
        count += 3
      }
      if (!linkIsBroken[rightLinks[bottomLeft]] && !linkIsBroken[downLinks[topRight]]) {
        triangleIndices.set([bottomLeft, bottomLeft + 1, topRight], count)
        count += 3
      }
    }
  }
  return count
}

function placeBalls(seconds, burstSeconds, width, height) {
  const approachZ = Math.min(-500 + Math.max(burstSeconds, 0) * 70, 0)
  const centerX = width / 2 + tilt.x, centerY = height / 2 + tilt.y
  const target = pointer.isDown ? pointer : { x: centerX, y: centerY }
  leader.x += (target.x - leader.x) * 0.08
  leader.y += (target.y - leader.y) * 0.08
  const balls = [{ x: leader.x, y: leader.y, z: approachZ - 40 }]
  const ringRadius = Math.min(width, height) * 0.3
  for (let ball = 0; ball < 4; ball++) {
    const angle = seconds * 0.04 + ball * Math.PI / 2
    balls.push({
      x: centerX + Math.cos(angle) * ringRadius,
      y: centerY + Math.sin(angle) * ringRadius * 0.8,
      z: approachZ + Math.sin(seconds * 1.7 + ball * 2) * 80
    })
  }
  return balls
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
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.cssText += 'position:fixed;top:0;left:0;z-index:9999;touch-action:none;visibility:visible'
  document.body.append(renderer.domElement)
  document.body.style.visibility = 'hidden'

  const fieldOfView = 50
  const cameraDistance = height / 2 / Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2))
  const camera = new THREE.PerspectiveCamera(fieldOfView, width / height, 1, cameraDistance + 8000)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#14051f')
  scene.fog = new THREE.Fog('#14051f', cameraDistance + 500, cameraDistance + 6000)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture

  const keyLight = new THREE.DirectionalLight('#ffffff', 2.45)
  keyLight.position.set(width * 0.1, height * 1.2, cameraDistance)
  keyLight.target.position.set(width / 2, height / 2, 0)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  Object.assign(keyLight.shadow.camera, { left: -width, right: width, top: height, bottom: -height, far: cameraDistance * 4 })
  keyLight.shadow.bias = -0.0005
  keyLight.shadow.normalBias = 1.5
  const floorGrid = new THREE.GridHelper(20000, 100, '#ff3fd2', '#6b2fa8')
  floorGrid.position.set(width / 2, -height * 0.4, 0)
  scene.add(keyLight, keyLight.target, new THREE.AmbientLight('#ffffff', 1.2), floorGrid)

  const texture = new THREE.CanvasTexture(snapshot)
  texture.colorSpace = THREE.SRGBColorSpace
  rows = Math.round(columns * height / width)
  const geometry = new THREE.PlaneGeometry(width, height, columns - 1, rows - 1).translate(width / 2, height / 2, 0)
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array((columns - 1) * (rows - 1) * 6), 1))
  const clothMesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }))
  clothMesh.castShadow = clothMesh.receiveShadow = true
  scene.add(clothMesh)

  positions = geometry.attributes.position.array
  previousPositions = positions.slice()
  isPinned = new Uint8Array(columns * rows)
  isPunctured = new Uint8Array(columns * rows)
  const maximumLinks = columns * rows * 5
  linkStart = new Uint32Array(maximumLinks)
  linkEnd = new Uint32Array(maximumLinks)
  linkRestLength = new Float32Array(maximumLinks)
  linkIsBroken = new Uint8Array(maximumLinks)
  for (let i = 0; i < columns * rows; i++) {
    const column = i % columns, row = Math.floor(i / columns)
    if (row === 0 || row === rows - 1 || column === 0 || column === columns - 1) isPinned[i] = 1
    if (column < columns - 1) rightLinks[i] = linkParticles(i, i + 1)
    if (row < rows - 1) downLinks[i] = linkParticles(i, i + columns)
    if (column < columns - 1 && row < rows - 1) diagonalLinks[i] = linkParticles(i + columns, i + 1)
    if (column < columns - 2) linkParticles(i, i + 2)
    if (row < rows - 2) linkParticles(i, i + columns * 2)
  }
  if (pointer.isDown) grabClothPatch()

  const chrome = new THREE.MeshPhysicalMaterial({ color: '#b48cff', metalness: 0.6, roughness: 0.15, clearcoat: 1, iridescence: 1 })
  const metaballs = new MarchingCubes(isTouchDevice ? 32 : 64, chrome, false, false, 200000)
  metaballs.isolation = ballIsolation
  metaballs.position.set(width / 2, height / 2, -100)
  metaballs.scale.setScalar(Math.max(width, height) / 2)
  metaballs.castShadow = true
  scene.add(metaballs)
  const toBox = (value, center) => (value - center) / metaballs.scale.x / 2 + 0.5
  const ballRadius = Math.sqrt(ballStrength / (ballSubtract + ballIsolation)) * 2 * metaballs.scale.x * 1.2
  camera.position.set(width / 2, height / 2, cameraDistance)
  camera.lookAt(width / 2, height / 2, 0)

  renderer.setAnimationLoop(time => {
    const seconds = time / 1000, burstSeconds = seconds - burstAfterSeconds
    const balls = placeBalls(seconds, burstSeconds, width, height)
    metaballs.reset()
    for (const ball of balls) {
      metaballs.addBall(toBox(ball.x, metaballs.position.x), toBox(ball.y, metaballs.position.y), toBox(ball.z, metaballs.position.z), ballStrength, ballSubtract)
    }
    metaballs.update()

    simulateCloth()
    for (const ball of balls) pushClothOutOfBall(ball, ballRadius)
    geometry.setDrawRange(0, writeVisibleTriangles(geometry.index.array))
    geometry.index.needsUpdate = true
    geometry.attributes.position.needsUpdate = true
    geometry.computeVertexNormals()
    renderer.render(scene, camera)
  })
}

addEventListener('pointerdown', event => {
  pointer.isDown = true
  updatePointer(event)
  if (ripStarted) return positions && grabClothPatch()
  if (event.target.closest('a, video, button')) return
  dragStart = { x: pointer.x, y: pointer.y }
  if (event.pointerType !== 'mouse' && event.target.closest('#peel')) startRip()
})

addEventListener('pointermove', event => {
  updatePointer(event)
  const draggedFar = dragStart && Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) > 30
  if (!ripStarted && event.pointerType === 'mouse' && draggedFar) startRip()
})

addEventListener('deviceorientation', event => {
  if (event.gamma === null) return
  tilt.x = event.gamma * 3
  tilt.y = (event.beta - 45) * -3
})

setTimeout(() => ripStarted || startRip(), burstAfterSeconds * 1000)
addEventListener('pointerup', releaseParticle)
addEventListener('pointercancel', releaseParticle)
