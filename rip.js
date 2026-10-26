const isTouchDevice = matchMedia('(pointer: coarse)').matches
const urlSettings = new URLSearchParams(location.search)
const setting = (name, fallback) => Number(urlSettings.get(name) ?? fallback)
const columns = setting('columns', isTouchDevice ? 80 : 160)
const relaxIterations = setting('iterations', 4), burstAfterSeconds = setting('burst', 5)
const roseCount = setting('roses', isTouchDevice ? 60 : 120), windStrength = setting('wind', 0.15)
const seasonHexes = [
  ['#ffc4d6', '#ff9ebb', '#ffffff', '#ffe3ec', '#ffb3c8', '#ffffff', '#ffe14d'],
  ['#4b4bd8', '#7a5cff', '#8fb4ff', '#f4f6ff', '#5b8cff'],
  ['#e8102e', '#ff5a1f', '#ffc21a', '#b0002a', '#ff8a3d'],
  ['#d7003a', '#ffffff', '#ffd1dc', '#c2002f', '#ffffff']
]
const petalsPerRose = 13, leavesPerRose = 3, goldenAngle = 2.39996, secondsPerSeason = 40
const gravity = 0.04, damping = 0.98, knifeRadius = 22, slashRadius = 30, maskScale = 0.5, scatterRadius = 120
const pointer = { x: 0, y: 0, isDown: false }
const tilt = { x: 0, y: 0 }
let linkStart, linkEnd, linkRestLength, linkCount = 0
let dragStart = null, lastCut = null, ripStarted = false, askedForGyro = false
let viewWidth, viewHeight, rowSpacing, rows, positions, previousPositions, isPinned, isPunctured
let seasonColors, currentSeason = 0
let holeMask, holeTexture, pagePointAt, pageLinks = [], scrolledRows = 0, scrollRemainder = 0

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
  const gust = windStrength * (0.6 + 0.4 * Math.sin(seconds * 0.3))
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
    positions[i * 3 + 2] += gust * (Math.sin(x * 0.012 + seconds * 0.8) * Math.sin(y * 0.009 + seconds * 0.6) + 0.5 * Math.sin((x + y) * 0.006 - seconds * 1.0))
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
  for (let angle = 0; angle < Math.PI * 2; angle += Math.min(0.2, 3 / radius)) {
    const raggedRadius = radius * (1 + 0.08 * Math.sin(angle * 3 + seed) + 0.04 * Math.sin(angle * 11 + seed * 3)) + 5 * Math.sin(angle * 37 + seed) + 3 * Math.sin(angle * 83)
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

function plantRose(rose, screenY) {
  rose.stream = Math.floor(Math.random() * 3)
  rose.streamOffset = (Math.random() - 0.5) * 0.16
  rose.screenY = screenY
  rose.z = -150 - Math.random() * 500
  rose.size = 28 + Math.random() * 28
  rose.riseSpeed = 25 + Math.random() * 30
  rose.tiltX = (Math.random() - 0.5) * 1.2
  rose.tiltZ = (Math.random() - 0.5) * 1.2
  rose.spin = Math.random() * Math.PI * 2
  rose.scatter = 0
  rose.color = randomSeasonColor()
}

function randomSeasonColor() {
  const palette = seasonColors[currentSeason]
  return palette[Math.floor(Math.random() * palette.length)]
}

function riseRose(rose, secondsPassed) {
  rose.screenY += rose.riseSpeed * secondsPassed
  rose.spin += secondsPassed * 0.2
  const streamCenter = [0.18, 0.5, 0.82][rose.stream] + rose.streamOffset + Math.sin(rose.screenY * 0.004 + rose.stream * 2) * 0.06
  rose.screenX = streamCenter * viewWidth + tilt.x
  const isTouched = pointer.isDown && Math.hypot(pointer.x - rose.screenX, pointer.y - rose.screenY) < scatterRadius
  if (rose.scatter > 0 || isTouched || rose.screenY > viewHeight * 0.92) rose.scatter += secondsPassed / 1.5
  if (rose.scatter >= 1) plantRose(rose, -60)
  const bloom = Math.min(Math.max(rose.screenY / (viewHeight * 0.6), 0), 1)
  return bloom * bloom * (3 - 2 * bloom)
}

function cuppedPetal(THREE) {
  const petal = new THREE.PlaneGeometry(1, 1, 4, 6).translate(0, 0.5, 0)
  const brightness = []
  for (let i = 0; i < petal.attributes.position.count; i++) {
    const x = petal.attributes.position.getX(i), y = petal.attributes.position.getY(i)
    const width = 0.1 + 0.9 * Math.sin(Math.PI * Math.min(y * 1.1, 1))
    petal.attributes.position.setXYZ(i, x * width, y, -x * x * 0.8 - y * y * 0.3)
    brightness.push(1 - 0.4 * y, 1 - 0.4 * y, 1 - 0.4 * y)
  }
  petal.setAttribute('color', new THREE.Float32BufferAttribute(brightness, 3))
  petal.computeVertexNormals()
  return petal
}

// Indigo ground with faint squares of gold leaf, like the folding screens teamLab paints its flowers on
function goldLeafTexture(THREE) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const context = canvas.getContext('2d')
  context.fillStyle = '#04071a'
  context.fillRect(0, 0, 1024, 1024)
  for (let mist = 0; mist < 6; mist++) {
    const x = Math.random() * 1024, y = Math.random() * 1024
    const indigoMist = context.createRadialGradient(x, y, 0, x, y, 300)
    indigoMist.addColorStop(0, 'rgba(30, 50, 120, 0.5)')
    indigoMist.addColorStop(1, 'rgba(30, 50, 120, 0)')
    context.fillStyle = indigoMist
    context.fillRect(0, 0, 1024, 1024)
  }
  for (let x = 0; x < 1024; x += 64) {
    for (let y = 0; y < 1024; y += 64) {
      context.fillStyle = `rgba(201, 162, 74, ${Math.random() * 0.05})`
      context.fillRect(x + 1, y + 1, 62, 62)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
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
  const [THREE, { default: html2canvas }] = await Promise.all([import('three'), import('html2canvas')])
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
  const screenDepth = -1400, screenHeight = 2 * (cameraDistance - screenDepth) * Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2)) * 1.4
  const goldLeaf = goldLeafTexture(THREE)
  goldLeaf.repeat.set(screenHeight * width / height / 1440, screenHeight / 1440)
  const foldingScreen = new THREE.Mesh(new THREE.PlaneGeometry(screenHeight * width / height, screenHeight), new THREE.MeshBasicMaterial({ map: goldLeaf }))
  foldingScreen.position.set(width / 2, height / 2, screenDepth)
  const keyLight = new THREE.DirectionalLight('#fff6f2', 2.45)
  keyLight.position.set(width * 0.1, height * 1.2, cameraDistance)
  keyLight.target.position.set(width / 2, height / 2, 0)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  Object.assign(keyLight.shadow.camera, { left: -width, right: width, top: height, bottom: -height, far: cameraDistance * 4 })
  keyLight.shadow.bias = -0.0005
  keyLight.shadow.normalBias = 1.5

  scene.add(foldingScreen, keyLight, keyLight.target, new THREE.AmbientLight('#ffffff', 1.2))
  const puffTexture = softPuffTexture(THREE)
  seasonColors = seasonHexes.map(palette => palette.map(hex => new THREE.Color(hex)))

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

  const moteCount = 700
  const motePositions = new Float32Array(moteCount * 3), moteColors = new Float32Array(moteCount * 3)
  for (let mote = 0; mote < moteCount; mote++) {
    motePositions.set([width / 2 + (Math.random() - 0.5) * 3000, (Math.random() * 2.3 - 0.3) * height, -200 - Math.random() * 1100], mote * 3)
    randomSeasonColor().toArray(moteColors, mote * 3)
  }
  const moteGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(motePositions, 3))
  moteGeometry.setAttribute('color', new THREE.BufferAttribute(moteColors, 3))
  const moteMaterial = new THREE.PointsMaterial({ map: puffTexture, vertexColors: true, size: 20, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  scene.add(new THREE.Points(moteGeometry, moteMaterial))

  rows = Math.round(columns * height / width)
  rowSpacing = height / (rows - 1)
  const geometry = new THREE.PlaneGeometry(width, height, columns - 1, rows - 1).translate(width / 2, height / 2, 0)
  const clothMaterial = new THREE.MeshLambertMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', alphaMap: holeTexture, alphaTest: 0.5, side: THREE.DoubleSide })
  const clothMesh = new THREE.Mesh(geometry, clothMaterial)
  clothMesh.castShadow = clothMesh.receiveShadow = true
  scene.add(clothMesh)
  const raycaster = new THREE.Raycaster()
  pagePointAt = (clientX, clientY) => {
    geometry.computeBoundingSphere()
    raycaster.setFromCamera(new THREE.Vector2(clientX / width * 2 - 1, 1 - clientY / height * 2), camera)
    const hit = raycaster.intersectObject(clothMesh)[0]
    if (!hit) return null
    const pageX = hit.uv.x * width, pageY = scrolledRows * rowSpacing + (1 - hit.uv.y) * height
    const isHole = holeMask.getImageData(pageX * maskScale, pageY * maskScale, 1, 1).data[0] < 128
    return isHole ? null : { x: pageX, y: pageY }
  }

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

  const petalShape = cuppedPetal(THREE)
  const glowingPetal = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  glowingPetal.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.6;')
  }
  const petals = new THREE.InstancedMesh(petalShape, glowingPetal, roseCount * petalsPerRose)
  const leaves = new THREE.InstancedMesh(petalShape, new THREE.MeshLambertMaterial({ color: '#2f7a45', vertexColors: true, side: THREE.DoubleSide }), roseCount * leavesPerRose)
  const glowPositions = new Float32Array(roseCount * 3), glowColors = new Float32Array(roseCount * 3)
  const glowGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(glowPositions, 3))
  glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3))
  const glows = new THREE.Points(glowGeometry, new THREE.PointsMaterial({ map: puffTexture, vertexColors: true, size: 200, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  for (const roseMesh of [petals, leaves, glows]) roseMesh.frustumCulled = false
  scene.add(petals, leaves, glows)
  const roses = Array.from({ length: roseCount }, () => {
    const rose = {}
    plantRose(rose, Math.random() * height)
    return rose
  })
  const rosePlacement = new THREE.Object3D(), partPlacement = new THREE.Object3D(), partMatrix = new THREE.Matrix4()
  const placePart = (mesh, index, azimuth, openAngle, width, length, scatter) => {
    partPlacement.rotation.set(openAngle, azimuth, scatter * 3, 'YXZ')
    partPlacement.position.set(Math.sin(azimuth), 0, Math.cos(azimuth)).multiplyScalar(0.05 + scatter * 2)
    partPlacement.scale.set(width, length, width).multiplyScalar(1 - scatter)
    partPlacement.updateMatrix()
    mesh.setMatrixAt(index, partMatrix.multiplyMatrices(rosePlacement.matrix, partPlacement.matrix))
  }
  const slashFrom = { x: width * 0.03, y: height * 0.72 }, slashTo = { x: width * 0.97, y: height * 0.3 }
  let slashDone = 0

  let ripStartSeconds = null, previousSeconds = null
  renderer.setAnimationLoop(time => {
    const seconds = time / 1000, tearSeconds = seconds - burstAfterSeconds - 3
    ripStartSeconds ??= seconds
    const secondsPassed = Math.min(seconds - (previousSeconds ?? seconds), 0.1)
    previousSeconds = seconds
    const lightShare = 0.5 * Math.min((seconds - ripStartSeconds) / 4, 1)
    clothMaterial.color.setScalar(lightShare)
    clothMaterial.emissiveIntensity = 1 - lightShare
    followScroll()
    clothMesh.position.y = scrollRemainder
    for (const pageTexture of [texture, holeTexture]) pageTexture.offset.y = 1 - (scrolledRows * rowSpacing + height) / pageHeight
    currentSeason = Math.floor((seconds - ripStartSeconds) / secondsPerSeason) % seasonHexes.length
    for (let mote = 0; mote < moteCount; mote++) {
      motePositions[mote * 3] += Math.sin(seconds * 0.3 + mote) * 0.2
      motePositions[mote * 3 + 1] += 0.2 + (mote % 5) * 0.06
      if (motePositions[mote * 3 + 1] > height * 2) {
        motePositions[mote * 3 + 1] = -height * 0.3
        randomSeasonColor().toArray(moteColors, mote * 3)
      }
    }
    moteGeometry.attributes.position.needsUpdate = moteGeometry.attributes.color.needsUpdate = true
    const slashTarget = Math.min(Math.max(tearSeconds / 0.8, 0), 1)
    while (slashDone < slashTarget) {
      slashDone = Math.min(slashDone + 0.004, slashTarget)
      const slashX = slashFrom.x + (slashTo.x - slashFrom.x) * slashDone
      const slashY = slashFrom.y + (slashTo.y - slashFrom.y) * slashDone + Math.sin(slashDone * Math.PI) * height * 0.08
      cutCloth(slashX, slashY, slashRadius, slashDone * 100)
    }

    roses.forEach((rose, roseIndex) => {
      const bloom = riseRose(rose, secondsPassed)
      const perspective = cameraDistance / (cameraDistance - rose.z)
      rosePlacement.position.set(width / 2 + (rose.screenX - width / 2) / perspective, height / 2 + (rose.screenY - height / 2) / perspective, rose.z)
      rosePlacement.rotation.set(Math.PI / 2 + rose.tiltX, 0, rose.tiltZ)
      rosePlacement.scale.setScalar(rose.size * (0.4 + 0.6 * bloom))
      rosePlacement.updateMatrix()
      for (let petal = 0; petal < petalsPerRose; petal++) {
        const outerness = petal / (petalsPerRose - 1)
        const petalIndex = roseIndex * petalsPerRose + petal
        placePart(petals, petalIndex, petal * goldenAngle + rose.spin, 0.15 + bloom * (0.15 + 1.25 * outerness), 0.9 * (0.45 + 0.6 * outerness), 0.45 + 0.6 * outerness, rose.scatter)
        petals.setColorAt(petalIndex, rose.color)
      }
      for (let leaf = 0; leaf < leavesPerRose; leaf++) {
        placePart(leaves, roseIndex * leavesPerRose + leaf, leaf * 2.1 + rose.spin + 0.5, 1.75, 0.45, 0.6 + 0.8 * bloom, rose.scatter)
      }
      rosePlacement.position.toArray(glowPositions, roseIndex * 3)
      rose.color.toArray(glowColors, roseIndex * 3)
      for (let channel = 0; channel < 3; channel++) glowColors[roseIndex * 3 + channel] *= 0.4 * bloom * (1 - rose.scatter)
    })
    for (const instances of [petals.instanceMatrix, petals.instanceColor, leaves.instanceMatrix, glowGeometry.attributes.position, glowGeometry.attributes.color]) instances.needsUpdate = true

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
})

addEventListener('pointermove', event => {
  updatePointer(event)
  const dragDistance = dragStart ? Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) : 0
  if (lastCut && holeMask) return dragDistance > 8 && cutAlongDrag()
  if (!ripStarted && event.pointerType === 'mouse' && dragDistance > 30) startRip()
})

addEventListener('pointerup', event => {
  updatePointer(event)
  const isTap = dragStart && Math.hypot(pointer.x - dragStart.x, pointer.y - dragStart.y) < 8
  const pagePoint = holeMask && isTap && pagePointAt(event.clientX, event.clientY)
  if (pagePoint) openLinkAt(pagePoint.x, pagePoint.y)
  releasePointer()
})

addEventListener('deviceorientation', event => {
  if (event.gamma === null) return
  tilt.x = event.gamma * 3
  tilt.y = (event.beta - 45) * -3
})

setTimeout(() => ripStarted || startRip(), burstAfterSeconds * 1000)
addEventListener('pointercancel', releasePointer)
