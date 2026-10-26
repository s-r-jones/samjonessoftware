const isTouchDevice = matchMedia('(pointer: coarse)').matches
const urlSettings = new URLSearchParams(location.search)
const setting = (name, fallback) => Number(urlSettings.get(name) ?? fallback)
const columns = setting('columns', isTouchDevice ? 80 : 160)
const relaxIterations = setting('iterations', 4), burstAfterSeconds = setting('burst', 8)
const flowerCount = setting('flowers', isTouchDevice ? 220 : 500), windStrength = setting('wind', 0.15)
const gravity = 0.04, damping = 0.98, knifeRadius = 19, slashRadius = 30, maskScale = 0.5, holdToCutMilliseconds = 100
const pointer = { x: 0, y: 0, isDown: false }
const tilt = { x: 0, y: 0 }
let linkStart, linkEnd, linkRestLength, linkCount = 0
let dragStart = null, lastCut = null, pressStartTime = 0, ripStarted = false, askedForGyro = false
let viewWidth, viewHeight, rowSpacing, rows, positions, previousPositions, isPinned, isPunctured
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

// Deep indigo night with soft drifting mist behind the flowers
function indigoMistTexture(THREE) {
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
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

async function startRip() {
  ripStarted = true
  const [THREE, { default: html2canvas }, { createFlowerField }] = await Promise.all([import('three'), import('html2canvas'), import('./flowers.js')])
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
  renderer.domElement.style.cssText += 'position:fixed;top:0;left:0;z-index:9999;touch-action:pan-y;-webkit-user-select:none;-webkit-touch-callout:none;visibility:visible'
  document.body.append(renderer.domElement)
  document.body.style.visibility = 'hidden'

  const fieldOfView = 50
  const cameraDistance = height / 2 / Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2))
  const camera = new THREE.PerspectiveCamera(fieldOfView, width / height, 1, cameraDistance + 9000)
  camera.position.set(width / 2, height / 2, cameraDistance)
  camera.lookAt(width / 2, height / 2, 0)
  const scene = new THREE.Scene()
  const screenDepth = -1400, screenHeight = 2 * (cameraDistance - screenDepth) * Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2)) * 1.4
  const indigoMist = indigoMistTexture(THREE)
  const foldingScreen = new THREE.Mesh(new THREE.PlaneGeometry(screenHeight * width / height, screenHeight), new THREE.MeshBasicMaterial({ map: indigoMist }))
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

  const flowers = createFlowerField(THREE, { flowerCount, moteCount: flowerCount * 2, width, height, cameraDistance, pixelRatio: renderer.getPixelRatio() })
  scene.add(flowers.field)
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

  const slashFrom = { x: width * 0.03, y: height * 0.72 }, slashTo = { x: width * 0.97, y: height * 0.3 }
  let slashDone = 0

  let ripStartSeconds = null
  renderer.setAnimationLoop(time => {
    const seconds = time / 1000, tearSeconds = seconds - burstAfterSeconds - 3
    ripStartSeconds ??= seconds
    const lightShare = 0.5 * Math.min((seconds - ripStartSeconds) / 4, 1)
    clothMaterial.color.setScalar(lightShare)
    clothMaterial.emissiveIntensity = 1 - lightShare
    followScroll()
    clothMesh.position.y = scrollRemainder
    for (const pageTexture of [texture, holeTexture]) pageTexture.offset.y = 1 - (scrolledRows * rowSpacing + height) / pageHeight
    // Starting the clock at the longest flower lifetime means every flower already on screen was born in spring
    flowers.uniforms.time.value = seconds - ripStartSeconds + 50
    flowers.field.position.set(tilt.x, tilt.y, 0)
    const slashTarget = Math.min(Math.max(tearSeconds / 0.8, 0), 1)
    while (slashDone < slashTarget) {
      slashDone = Math.min(slashDone + 0.004, slashTarget)
      const slashX = slashFrom.x + (slashTo.x - slashFrom.x) * slashDone
      const slashY = slashFrom.y + (slashTo.y - slashFrom.y) * slashDone + Math.sin(slashDone * Math.PI) * height * 0.08
      cutCloth(slashX, slashY, slashRadius, slashDone * 100)
    }

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
    pressStartTime = performance.now()
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

// A quick flick scrolls the page, but a finger that rests for a moment becomes a knife that can cut in any direction.
// Safari decides on the first touchmove whether to scroll, and a resting finger jitters, so tiny moves count as resting.
addEventListener('touchmove', event => {
  if (!lastCut) return
  const touch = event.touches[0]
  const isStillResting = Math.hypot(touch.clientX - dragStart.x, innerHeight - touch.clientY - dragStart.y) < 6
  const isHoldingKnife = isStillResting || performance.now() - pressStartTime > holdToCutMilliseconds
  if (isHoldingKnife) event.preventDefault()
}, { passive: false })

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
