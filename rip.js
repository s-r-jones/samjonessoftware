const isTouchDevice = matchMedia('(pointer: coarse)').matches
const urlSettings = new URLSearchParams(location.search)
const setting = (name, fallback) => Number(urlSettings.get(name) ?? fallback)
const columns = setting('columns', isTouchDevice ? 80 : 160)
const relaxIterations = setting('iterations', 4), punctureDepth = setting('puncture', 0.5)
const burstAfterSeconds = setting('burst', 30), ballStrength = setting('ball', 0.45)
const windStrength = setting('wind', 0.15), ballGravity = setting('gravity', 1500)
const gravity = 0.04, damping = 0.98, ballSubtract = 30, ballIsolation = 80, knifeRadius = 22, maskScale = 0.5
const pointer = { x: 0, y: 0, isDown: false }
const tilt = { x: 0, y: 0 }
let linkStart, linkEnd, linkRestLength, linkCount = 0
let dragStart = null, lastCut = null, ripStarted = false, askedForGyro = false
let viewWidth, viewHeight, rowSpacing, rows, positions, previousPositions, isPinned, isPunctured
let holeMask, holeTexture, balls, ballRadius, pageLinks = [], scrolledRows = 0, scrollRemainder = 0

function updatePointer(event) {
  pointer.x = event.clientX
  pointer.y = innerHeight - event.clientY
}

function releasePointer() {
  pointer.isDown = false
  dragStart = lastCut = null
  if (ripStarted && !askedForGyro && window.DeviceOrientationEvent?.requestPermission) {
    askedForGyro = true
    DeviceOrientationEvent.requestPermission()
  }
}

function openLinkAt(pageX, pageY) {
  const link = pageLinks.find(link => pageX > link.left && pageX < link.right && pageY > link.top && pageY < link.bottom)
  if (link) location.href = link.href
}

function linkParticles(a, b) {
  linkStart[linkCount] = a
  linkEnd[linkCount] = b
  linkRestLength[linkCount] = Math.hypot(positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1])
  linkCount++
}

function resetParticle(i) {
  const restPosition = [(i % columns) * viewWidth / (columns - 1), viewHeight - Math.floor(i / columns) * rowSpacing, 0]
  positions.set(restPosition, i * 3)
  previousPositions.set(restPosition, i * 3)
}

function followScroll() {
  const shift = Math.round(scrollY / rowSpacing) - scrolledRows
  scrolledRows += shift
  scrollRemainder = scrollY - scrolledRows * rowSpacing
  if (shift === 0) return
  for (const values of [positions, previousPositions]) {
    if (shift > 0) values.copyWithin(0, shift * columns * 3)
    else values.copyWithin(-shift * columns * 3, 0, (rows + shift) * columns * 3)
    for (let i = 1; i < values.length; i += 3) values[i] += shift * rowSpacing
  }
  if (shift > 0) isPunctured.copyWithin(0, shift * columns)
  else isPunctured.copyWithin(-shift * columns, 0, (rows + shift) * columns)
  for (let i = 0; i < columns * rows; i++) {
    const row = Math.floor(i / columns)
    const isNewRow = shift > 0 ? row >= rows - shift : row < -shift
    if (isNewRow) isPunctured[i] = 0
    if (isNewRow || isPinned[i]) resetParticle(i)
  }
}

function simulateCloth(seconds) {
  const gust = windStrength * (0.6 + 0.4 * Math.sin(seconds * 0.7))
  for (let i = 0; i < columns * rows; i++) {
    if (isPinned[i] || isPunctured[i]) continue
    for (let axis = 0; axis < 3; axis++) {
      const index = i * 3 + axis
      const velocity = (positions[index] - previousPositions[index]) * damping
      previousPositions[index] = positions[index]
      positions[index] += velocity
    }
    const x = positions[i * 3], y = positions[i * 3 + 1]
    positions[i * 3 + 1] -= gravity
    positions[i * 3 + 2] += gust * (Math.sin(x * 0.012 + seconds * 1.9) * Math.sin(y * 0.009 + seconds * 1.3) + 0.5 * Math.sin((x + y) * 0.006 - seconds * 2.3))
  }
  for (let iteration = 0; iteration < relaxIterations; iteration++) {
    for (let link = 0; link < linkCount; link++) {
      const start = linkStart[link], end = linkEnd[link]
      if (isPunctured[start] || isPunctured[end]) continue
      const a = start * 3, b = end * 3
      const deltaX = positions[b] - positions[a], deltaY = positions[b + 1] - positions[a + 1], deltaZ = positions[b + 2] - positions[a + 2]
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)
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

function cutCloth(x, y, radius, seed) {
  const clothY = y - scrollRemainder
  const pageY = scrolledRows * rowSpacing + viewHeight - clothY
  holeMask.beginPath()
  for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
    const raggedRadius = radius * (1 + 0.12 * Math.sin(angle * 5 + seed) + 0.06 * Math.sin(angle * 13 + seed * 3))
    holeMask.lineTo((x + Math.cos(angle) * raggedRadius) * maskScale, (pageY - Math.sin(angle) * raggedRadius) * maskScale)
  }
  holeMask.fill()
  holeTexture.needsUpdate = true

  const releaseRadius = radius * 0.8 - 1.5 * viewWidth / (columns - 1)
  for (let i = 0; i < columns * rows; i++) {
    const restX = (i % columns) * viewWidth / (columns - 1), restY = viewHeight - Math.floor(i / columns) * rowSpacing
    if ((restX - x) ** 2 + (restY - clothY) ** 2 < releaseRadius ** 2) isPunctured[i] = 1
  }
}

function cutAlongDrag() {
  const steps = Math.ceil(Math.hypot(pointer.x - lastCut.x, pointer.y - lastCut.y) / 4)
  for (let step = 1; step <= steps; step++) {
    cutCloth(lastCut.x + (pointer.x - lastCut.x) * step / steps, lastCut.y + (pointer.y - lastCut.y) * step / steps, knifeRadius, step)
  }
  lastCut = { x: pointer.x, y: pointer.y }
}

function gravityPull(from, to, strength, restDistance) {
  const deltaX = to.x - from.x, deltaY = to.y - from.y
  const distanceSquared = deltaX * deltaX + deltaY * deltaY + 3000
  const pull = strength * (1 - restDistance ** 2 / distanceSquared) / (distanceSquared * Math.sqrt(distanceSquared))
  return [deltaX * pull, deltaY * pull]
}

function moveBalls(seconds, burstSeconds) {
  const home = { x: viewWidth / 2 + tilt.x, y: viewHeight / 2 + tilt.y }
  balls.forEach((ball, index) => {
    const frontZ = ballRadius * 1.3 + Math.sin(seconds * 1.3 + index) * 15
    ball.z = Math.min(-500 + Math.max(burstSeconds, 0) * 70 - index * 80, frontZ)
    if (ball.z < ballRadius) return
    const pulls = [[(home.x - ball.x) * 0.0004, (home.y - ball.y) * 0.0004], [(ball.y - home.y) * 0.0003, (home.x - ball.x) * 0.0003]]
    for (const other of balls) if (other !== ball) pulls.push(gravityPull(ball, other, ballGravity, ballRadius * 2.2))
    if (pointer.isDown) pulls.push(gravityPull(ball, pointer, ballGravity * 4, 0))
    for (const [pullX, pullY] of pulls) {
      ball.velocityX += pullX
      ball.velocityY += pullY
    }
    ball.velocityX *= 0.985
    ball.velocityY *= 0.985
    ball.x += ball.velocityX
    ball.y += ball.velocityY
  })
}

function sunsetSky(THREE, radius) {
  const geometry = new THREE.SphereGeometry(radius, 32, 16)
  const stops = ['#ffc49a', '#ff9a8b', '#d77aa6', '#7b5aa6', '#2c2260'].map(hex => new THREE.Color(hex))
  const desertColor = new THREE.Color('#9c5f5a')
  const colors = []
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const verticalPosition = geometry.attributes.position.getY(i) / radius
    const height = Math.max(verticalPosition, 0) ** 0.6 * (stops.length - 1)
    const lower = Math.min(Math.floor(height), stops.length - 2)
    const color = stops[lower].clone().lerp(stops[lower + 1], height - lower)
    if (verticalPosition < 0) color.lerp(desertColor, Math.min(-verticalPosition * 4, 1))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }))
}

function softPuffTexture(THREE) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(canvas)
}

async function startRip() {
  ripStarted = true
  const [THREE, { MarchingCubes }, { default: html2canvas }] = await Promise.all([
    import('three'), import('three/addons/objects/MarchingCubes.js'), import('html2canvas')
  ])
  // Safari never loads lazy images inside html2canvas's offscreen clone, so the snapshot hangs forever
  document.querySelectorAll('img').forEach(image => image.loading = 'eager')
  document.querySelectorAll('video').forEach(video => video.outerHTML = `<img src="${video.poster}" width="${video.width}">`)
  const width = viewWidth = document.documentElement.clientWidth, height = viewHeight = innerHeight
  const pageHeight = document.documentElement.scrollHeight
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  // iOS Safari refuses canvases over about 16 million pixels
  const snapshotScale = Math.min(devicePixelRatio, 2, renderer.capabilities.maxTextureSize / pageHeight, Math.sqrt(16e6 / (width * pageHeight)))
  const snapshot = await html2canvas(document.body, { x: 0, y: 0, width, height: pageHeight, windowWidth: width, scale: snapshotScale })
  pageLinks = [...document.querySelectorAll('a')].map(link => {
    const box = link.getBoundingClientRect()
    return { href: link.href, left: box.left + scrollX, right: box.right + scrollX, top: box.top + scrollY, bottom: box.bottom + scrollY }
  })

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.cssText += 'position:fixed;top:0;left:0;z-index:9999;touch-action:pan-y;visibility:visible'
  document.body.append(renderer.domElement)
  document.body.style.visibility = 'hidden'

  const fieldOfView = 50
  const cameraDistance = height / 2 / Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2))
  const camera = new THREE.PerspectiveCamera(fieldOfView, width / height, 1, cameraDistance + 9000)
  camera.position.set(width / 2, height / 2, cameraDistance)
  camera.lookAt(width / 2, height / 2, 0)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog('#ffc49a', cameraDistance + 800, cameraDistance + 7000)
  const sky = sunsetSky(THREE, 8000)
  sky.position.copy(camera.position)
  const sunForReflections = new THREE.Mesh(new THREE.SphereGeometry(5), new THREE.MeshBasicMaterial({ color: '#fff4d6' }))
  sunForReflections.position.set(15, 4, -40)
  const skyForReflections = new THREE.Scene().add(sunsetSky(THREE, 50), sunForReflections)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(skyForReflections).texture

  const keyLight = new THREE.DirectionalLight('#ffe6cc', 2.45)
  keyLight.position.set(width * 0.1, height * 1.2, cameraDistance)
  keyLight.target.position.set(width / 2, height / 2, 0)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  Object.assign(keyLight.shadow.camera, { left: -width, right: width, top: height, bottom: -height, far: cameraDistance * 4 })
  keyLight.shadow.bias = -0.0005
  keyLight.shadow.normalBias = 1.5

  const dunes = new THREE.PlaneGeometry(20000, 20000, 120, 120).rotateX(-Math.PI / 2)
  for (let i = 0; i < dunes.attributes.position.count; i++) {
    const x = dunes.attributes.position.getX(i), z = dunes.attributes.position.getZ(i)
    dunes.attributes.position.setY(i, Math.sin(x * 0.0012) * Math.cos(z * 0.0009) * 120 + Math.sin(x * 0.0031 + z * 0.002) * 40)
  }
  dunes.computeVertexNormals()
  const desert = new THREE.Mesh(dunes, new THREE.MeshLambertMaterial({ color: '#d9967a' }))
  desert.position.set(width / 2, -height * 0.6, 0)
  scene.add(sky, keyLight, keyLight.target, new THREE.AmbientLight('#ffffff', 1.2), desert)

  const puffTexture = softPuffTexture(THREE)
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture, color: '#fff1c1', fog: false, depthWrite: false }))
  sun.position.set(width / 2 + 1500, height * 0.2, -7000)
  sun.scale.setScalar(2500)
  scene.add(sun)
  const cloudPuffs = []
  for (let cloud = 0; cloud < 25; cloud++) {
    const cloudX = width / 2 + (Math.random() - 0.5) * 14000, cloudY = height * (0.5 + Math.random() * 2.5), cloudZ = -1500 - Math.random() * 5500
    const tint = ['#ffffff', '#ffd6e0', '#ffc9a8'][cloud % 3]
    for (let puff = 0; puff < 6; puff++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture, color: tint, transparent: true, opacity: 0.55, depthWrite: false }))
      sprite.position.set(cloudX + (Math.random() - 0.5) * 900, cloudY + (Math.random() - 0.5) * 200, cloudZ + (Math.random() - 0.5) * 300)
      sprite.scale.setScalar(500 + Math.random() * 700)
      cloudPuffs.push(sprite)
      scene.add(sprite)
    }
  }

  const texture = new THREE.CanvasTexture(snapshot)
  texture.colorSpace = THREE.SRGBColorSpace
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = Math.round(width * maskScale)
  maskCanvas.height = Math.round(pageHeight * maskScale)
  holeMask = maskCanvas.getContext('2d')
  holeMask.fillStyle = 'white'
  holeMask.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
  holeMask.fillStyle = 'black'
  holeTexture = new THREE.CanvasTexture(maskCanvas)
  for (const pageTexture of [texture, holeTexture]) pageTexture.repeat.y = height / pageHeight

  rows = Math.round(columns * height / width)
  rowSpacing = height / (rows - 1)
  const geometry = new THREE.PlaneGeometry(width, height, columns - 1, rows - 1).translate(width / 2, height / 2, 0)
  const clothMaterial = new THREE.MeshLambertMaterial({ map: texture, alphaMap: holeTexture, alphaTest: 0.5, side: THREE.DoubleSide })
  const clothMesh = new THREE.Mesh(geometry, clothMaterial)
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
  for (let i = 0; i < columns * rows; i++) {
    const column = i % columns, row = Math.floor(i / columns)
    if (row === 0 || row === rows - 1 || column === 0 || column === columns - 1) isPinned[i] = 1
    if (column < columns - 1) linkParticles(i, i + 1)
    if (row < rows - 1) linkParticles(i, i + columns)
    if (column < columns - 1 && row < rows - 1) linkParticles(i + columns, i + 1)
    if (column < columns - 2) linkParticles(i, i + 2)
    if (row < rows - 2) linkParticles(i, i + columns * 2)
  }

  const chrome = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 1, roughness: 0.08, clearcoat: 1, iridescence: 0.4 })
  const metaballs = new MarchingCubes(isTouchDevice ? 32 : 64, chrome, false, false, 200000)
  metaballs.isolation = ballIsolation
  metaballs.position.set(width / 2, height / 2, -100)
  metaballs.scale.setScalar(Math.max(width, height) / 2)
  metaballs.castShadow = true
  scene.add(metaballs)
  const toBox = (value, center) => (value - center) / metaballs.scale.x / 2 + 0.5
  ballRadius = Math.sqrt(ballStrength / (ballSubtract + ballIsolation)) * 2 * metaballs.scale.x * 1.2
  balls = Array.from({ length: 5 }, (_, index) => {
    const angle = index * Math.PI * 2 / 5, ringRadius = Math.min(width, height) * 0.25
    return { x: width / 2 + Math.cos(angle) * ringRadius, y: height / 2 + Math.sin(angle) * ringRadius, z: -500, velocityX: -Math.sin(angle) * 2, velocityY: Math.cos(angle) * 2 }
  })

  renderer.setAnimationLoop(time => {
    const seconds = time / 1000, burstSeconds = seconds - burstAfterSeconds
    followScroll()
    clothMesh.position.y = scrollRemainder
    for (const pageTexture of [texture, holeTexture]) pageTexture.offset.y = 1 - (scrolledRows * rowSpacing + height) / pageHeight
    for (const puff of cloudPuffs) puff.position.x = (puff.position.x + 7000 + 0.3) % 14000 - 7000

    moveBalls(seconds, burstSeconds)
    metaballs.reset()
    balls.forEach((ball, index) => {
      metaballs.addBall(toBox(ball.x, metaballs.position.x), toBox(ball.y, metaballs.position.y), toBox(ball.z, metaballs.position.z), ballStrength, ballSubtract)
      const pushedThrough = ball.z + ballRadius * punctureDepth
      if (pushedThrough > 0 && ball.z < ballRadius) cutCloth(ball.x, ball.y, Math.min(pushedThrough * 2, ballRadius), index)
    })
    metaballs.update()

    simulateCloth(seconds)
    geometry.attributes.position.needsUpdate = true
    geometry.computeVertexNormals()
    renderer.render(scene, camera)
  })
}

addEventListener('pointerdown', event => {
  pointer.isDown = true
  updatePointer(event)
  if (ripStarted) {
    dragStart = lastCut = { x: pointer.x, y: pointer.y }
    return
  }
  if (event.target.closest('a, video, button')) return
  dragStart = { x: pointer.x, y: pointer.y }
  if (event.pointerType !== 'mouse' && event.target.closest('#peel')) startRip()
})

addEventListener('pointermove', event => {
  updatePointer(event)
  if (lastCut && holeMask) return cutAlongDrag()
  const draggedFar = dragStart && Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) > 30
  if (!ripStarted && event.pointerType === 'mouse' && draggedFar) startRip()
})

addEventListener('pointerup', event => {
  updatePointer(event)
  const isTap = dragStart && Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) < 8
  if (holeMask && isTap) openLinkAt(event.clientX + scrollX, event.clientY + scrollY)
  releasePointer()
})

addEventListener('deviceorientation', event => {
  if (event.gamma === null) return
  tilt.x = event.gamma * 3
  tilt.y = (event.beta - 45) * -3
})

setTimeout(() => ripStarted || startRip(), burstAfterSeconds * 1000)
addEventListener('pointercancel', releasePointer)
