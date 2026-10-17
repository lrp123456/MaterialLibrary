import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * 工业级 ThreeDirector: 虚拟导演台 3D 舞台与多物体/子部件变换引擎
 */
export class ThreeDirector {
  constructor(container, options = {}) {
    this.container = container
    this.options = options
    this.width = container.clientWidth || 800
    this.height = container.clientHeight || 500

    this.scene = null
    this.camera = null
    this.renderer = null
    this.orbitControls = null
    this.transformControls = null
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
    this.gltfLoader = new GLTFLoader()

    // 基础环境与辅助
    this.shadowPlane = null
    this.gridHelper = null
    this.dirLight = null
    this.ambientLight = null

    // 多物品场景管理
    this.sceneItems = [] // [{ id, name, type, rootObject, internalParts: [{ id, name, object }] }]
    this.selectedItemId = null
    this.selectedPartId = null // 为 null 表示选中根物体，不为 null 表示选中内部子部件

    // 默认关键帧机位（起始 / 结束）
    this.keyframePresets = {
      eye: { pos: [0, 1.4, 3.2], target: [0, 0.5, 0], fov: 38 },
      top: { pos: [0, 2.6, 3.0], target: [0, 0.4, 0], fov: 42 },
      close: { pos: [0.75, 0.85, 1.9], target: [0.15, 0.45, 0], fov: 28 }
    }

    this.startFrame = {
      position: new THREE.Vector3(0, 1.35, 3.3),
      target: new THREE.Vector3(0, 0.45, 0),
      fov: 38
    }
    this.endFrame = {
      position: new THREE.Vector3(0.9, 0.95, 2.3),
      target: new THREE.Vector3(0.1, 0.45, 0),
      fov: 30
    }

    this.isDirectingPreview = false
    this.animFrameId = null

    // 回调事件
    this.onSelectionChange = options.onSelectionChange || null
    this.onTransformChange = options.onTransformChange || null
    this.onCameraChange = options.onCameraChange || null

    this.init()
  }

  init() {
    // 1. 场景
    this.scene = new THREE.Scene()

    // 2. 相机
    this.camera = new THREE.PerspectiveCamera(38, this.width / this.height, 0.1, 100)
    this.camera.position.copy(this.startFrame.position)

    // 3. WebGL 渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setSize(this.width, this.height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.container.appendChild(this.renderer.domElement)

    // 4. 灯光系统
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.85)
    this.scene.add(this.ambientLight)

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdbeafe, 0.45)
    hemiLight.position.set(0, 20, 0)
    this.scene.add(hemiLight)

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.9)
    this.dirLight.position.set(3.5, 6.5, 2.8)
    this.dirLight.castShadow = true
    this.dirLight.shadow.mapSize.width = 2048
    this.dirLight.shadow.mapSize.height = 2048
    this.dirLight.shadow.camera.near = 0.5
    this.dirLight.shadow.camera.far = 16
    this.dirLight.shadow.camera.left = -3.5
    this.dirLight.shadow.camera.right = 3.5
    this.dirLight.shadow.camera.top = 3.5
    this.dirLight.shadow.camera.bottom = -3.5
    this.dirLight.shadow.bias = -0.0002
    this.dirLight.shadow.radius = 3.5
    this.scene.add(this.dirLight)

    // 5. 阴影捕获地面 (Shadow Catcher)
    const shadowGeo = new THREE.PlaneGeometry(24, 24)
    const shadowMat = new THREE.ShadowMaterial({
      opacity: 0.45,
      color: 0x0f172a
    })
    this.shadowPlane = new THREE.Mesh(shadowGeo, shadowMat)
    this.shadowPlane.rotation.x = -Math.PI / 2
    this.shadowPlane.position.y = 0
    this.shadowPlane.receiveShadow = true
    this.scene.add(this.shadowPlane)

    // 6. 透视地面辅助网格
    this.gridHelper = new THREE.GridHelper(10, 20, 0x2563eb, 0x64748b)
    this.gridHelper.position.y = 0.002
    this.gridHelper.material.opacity = 0.35
    this.gridHelper.material.transparent = true
    this.scene.add(this.gridHelper)

    // 7. 轨道相机控制器
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.06
    this.orbitControls.target.copy(this.startFrame.target)
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.03
    this.orbitControls.minDistance = 0.6
    this.orbitControls.maxDistance = 14
    this.orbitControls.addEventListener('change', () => {
      if (this.onCameraChange && !this.isDirectingPreview) {
        this.emitCameraState()
      }
    })

    // 8. 3D 变换手柄 (TransformControls)
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
    this.transformControls.size = 0.8
    this.transformControls.showY = true
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value
    })
    this.transformControls.addEventListener('change', () => {
      this.handleTransformChanged()
    })
    const helper = this.transformControls.getHelper ? this.transformControls.getHelper() : this.transformControls
    this.scene.add(helper)

    // 9. 视口点击拾取对象
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this))

    // 10. 默认添加一件北欧三人主沙发
    this.addItem('sofa', { name: '主位·北欧极简沙发', position: [0, 0, 0] })

    // 11. 渲染循环与窗口自适应
    this.renderLoop = this.renderLoop.bind(this)
    this.renderLoop()

    this.handleResize = this.handleResize.bind(this)
    window.addEventListener('resize', this.handleResize)
  }

  // ----------------------------------------------------
  // 多物品场景构建与管理
  // ----------------------------------------------------

  /**
   * 向场景添加物件
   */
  addItem(type, customConfig = {}) {
    const id = 'item_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
    let itemData = null

    if (type === 'sofa') {
      itemData = this.buildSofaItem(id, customConfig)
    } else if (type === 'armchair') {
      itemData = this.buildArmchairItem(id, customConfig)
    } else if (type === 'table') {
      itemData = this.buildCoffeeTableItem(id, customConfig)
    } else if (type === 'lamp') {
      itemData = this.buildFloorLampItem(id, customConfig)
    }

    if (itemData) {
      this.scene.add(itemData.rootObject)
      this.sceneItems.push(itemData)
      this.selectItem(itemData.id, null)
      this.snapObjectToGround(itemData.rootObject)
      return itemData
    }
    return null
  }

  /**
   * 移除场景中指定物品
   */
  removeItem(itemId) {
    const idx = this.sceneItems.findIndex((it) => it.id === itemId)
    if (idx >= 0) {
      const item = this.sceneItems[idx]
      if (this.selectedItemId === itemId) {
        this.transformControls.detach()
        this.selectedItemId = null
        this.selectedPartId = null
      }
      this.scene.remove(item.rootObject)
      this.sceneItems.splice(idx, 1)

      if (this.sceneItems.length > 0) {
        this.selectItem(this.sceneItems[0].id)
      } else if (this.onSelectionChange) {
        this.onSelectionChange(null)
      }
    }
  }

  /**
   * 选中物体（可选中整件物体，或深入选中内部子部件）
   */
  selectItem(itemId, partId = null) {
    const item = this.sceneItems.find((it) => it.id === itemId)
    if (!item) return

    this.selectedItemId = itemId
    this.selectedPartId = partId

    let targetObject = item.rootObject
    if (partId) {
      const part = item.internalParts.find((p) => p.id === partId)
      if (part && part.object) {
        targetObject = part.object
      }
    }

    this.transformControls.detach()
    this.transformControls.attach(targetObject)

    if (this.onSelectionChange) {
      this.onSelectionChange({
        item,
        selectedPartId: this.selectedPartId,
        transform: this.getCurrentTransformValues()
      })
    }
  }

  /**
   * 获取当前选中对象的变换参数
   */
  getCurrentTransformValues() {
    const target = this.transformControls.object
    if (!target) return null

    return {
      x: Number(target.position.x.toFixed(3)),
      y: Number(target.position.y.toFixed(3)),
      z: Number(target.position.z.toFixed(3)),
      yaw: Number(THREE.MathUtils.radToDeg(target.rotation.y).toFixed(1)),
      pitch: Number(THREE.MathUtils.radToDeg(target.rotation.x).toFixed(1)),
      roll: Number(THREE.MathUtils.radToDeg(target.rotation.z).toFixed(1)),
      scale: Number(target.scale.x.toFixed(2))
    }
  }

  /**
   * 手动设置当前选中的物体（或内部部件）的旋转角度与位置
   */
  setSelectedRotation(yawDeg, pitchDeg = 0, rollDeg = 0) {
    const target = this.transformControls.object
    if (!target) return
    target.rotation.y = THREE.MathUtils.degToRad(yawDeg)
    if (pitchDeg !== undefined) target.rotation.x = THREE.MathUtils.degToRad(pitchDeg)
    if (rollDeg !== undefined) target.rotation.z = THREE.MathUtils.degToRad(rollDeg)
  }

  setSelectedPosition(x, y, z) {
    const target = this.transformControls.object
    if (!target) return
    if (x !== undefined) target.position.x = x
    if (y !== undefined) target.position.y = y
    if (z !== undefined) target.position.z = z
  }

  setSelectedScale(val) {
    const target = this.transformControls.object
    if (!target) return
    target.scale.setScalar(val)
  }

  snapSelectedToGround() {
    const target = this.transformControls.object
    if (!target) return
    // 如果是子部件，不吸附地表；只有根物体才吸附
    const isRoot = !this.selectedPartId
    if (isRoot) {
      this.snapObjectToGround(target)
    }
  }

  snapObjectToGround(obj) {
    const box = new THREE.Box3().setFromObject(obj)
    obj.position.y += 0 - box.min.y
  }

  // ----------------------------------------------------
  // 高保真内部可解耦部件的模型构建
  // ----------------------------------------------------

  buildSofaItem(id, config = {}) {
    const root = new THREE.Group()
    root.name = config.name || '北欧极简三人位沙发'
    if (config.position) root.position.set(...config.position)

    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0xf3efe7,
      roughness: 0.62,
      metalness: 0.08
    })
    const cushionMat = new THREE.MeshStandardMaterial({
      color: 0xe6dfd2,
      roughness: 0.76,
      metalness: 0.04
    })
    const pillowMat = new THREE.MeshStandardMaterial({
      color: 0xc4b59d, // 雅致暖灰燕麦色
      roughness: 0.85,
      metalness: 0.02
    })
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.32,
      metalness: 0.85
    })

    const seatWidth = 1.68

    // 1. 底座
    const seat = new THREE.Mesh(new THREE.BoxGeometry(seatWidth, 0.22, 0.84), leatherMat)
    seat.position.y = 0.36
    seat.castShadow = true
    seat.receiveShadow = true
    root.add(seat)

    // 2. 靠背 (可独立微调)
    const back = new THREE.Mesh(new THREE.BoxGeometry(seatWidth + 0.02, 0.52, 0.18), leatherMat)
    back.position.set(0, 0.65, -0.34)
    back.rotation.x = -0.05
    back.castShadow = true
    root.add(back)

    // 3. 坐垫层
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.8), cushionMat)
    c1.position.set(-0.41, 0.48, 0.01)
    c1.castShadow = true
    root.add(c1)

    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.8), cushionMat)
    c2.position.set(0.41, 0.48, 0.01)
    c2.castShadow = true
    root.add(c2)

    // 4. 左靠枕 (内部可调部件)
    const pillowL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.14), pillowMat)
    pillowL.position.set(-0.52, 0.68, -0.22)
    pillowL.rotation.set(0.12, 0.25, 0.06)
    pillowL.castShadow = true
    root.add(pillowL)

    // 5. 右靠枕 (内部可调部件)
    const pillowR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.14), pillowMat)
    pillowR.position.set(0.52, 0.68, -0.22)
    pillowR.rotation.set(0.12, -0.25, -0.06)
    pillowR.castShadow = true
    root.add(pillowR)

    // 6. 扶手
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.86), leatherMat)
    armL.position.set(-(seatWidth / 2 + 0.09), 0.48, 0)
    armL.castShadow = true
    root.add(armL)

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.86), leatherMat)
    armR.position.set(seatWidth / 2 + 0.09, 0.48, 0)
    armR.castShadow = true
    root.add(armR)

    // 7. 金属腿
    const legGeo = new THREE.CylinderGeometry(0.025, 0.016, 0.28, 16)
    ;[
      [-0.78, 0.14, 0.35],
      [0.78, 0.14, 0.35],
      [-0.78, 0.14, -0.35],
      [0.78, 0.14, -0.35]
    ].forEach(([lx, ly, lz]) => {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(lx, ly, lz)
      leg.castShadow = true
      root.add(leg)
    })

    return {
      id,
      name: config.name || '北欧极简三人位沙发',
      type: 'sofa',
      rootObject: root,
      internalParts: [
        { id: 'part_pillow_l', name: '左侧靠垫抱枕', object: pillowL },
        { id: 'part_pillow_r', name: '右侧靠垫抱枕', object: pillowR },
        { id: 'part_back', name: '主靠背组件', object: back }
      ]
    }
  }

  buildArmchairItem(id, config = {}) {
    const root = new THREE.Group()
    root.name = config.name || '单人轻奢扶手椅'
    if (config.position) root.position.set(...config.position)
    else root.position.set(1.4, 0, 0.2)

    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x2e353b, // 沉稳墨黑/碳素色
      roughness: 0.58,
      metalness: 0.12
    })
    const pillowMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // 点缀焦糖橙
      roughness: 0.72,
      metalness: 0.05
    })
    const woodLegMat = new THREE.MeshStandardMaterial({
      color: 0x5a3e2b,
      roughness: 0.45,
      metalness: 0.15
    })

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.16, 0.78), leatherMat)
    seat.position.y = 0.38
    seat.castShadow = true
    seat.receiveShadow = true
    root.add(seat)

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.58, 0.16), leatherMat)
    back.position.set(0, 0.68, -0.32)
    back.rotation.x = -0.06
    back.castShadow = true
    root.add(back)

    // 单人椅点缀靠枕 (可独立微调)
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.12), pillowMat)
    pillow.position.set(0, 0.62, -0.22)
    pillow.rotation.set(0.12, 0.18, 0)
    pillow.castShadow = true
    root.add(pillow)

    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.78), leatherMat)
    armL.position.set(-0.46, 0.48, 0)
    armL.castShadow = true
    root.add(armL)

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.78), leatherMat)
    armR.position.set(0.46, 0.48, 0)
    armR.castShadow = true
    root.add(armR)

    // 4 条胡桃木腿
    const legGeo = new THREE.CylinderGeometry(0.024, 0.015, 0.34, 16)
    ;[
      [-0.36, 0.16, 0.3, 0.1, -0.1],
      [0.36, 0.16, 0.3, 0.1, 0.1],
      [-0.36, 0.16, -0.3, -0.1, -0.1],
      [0.36, 0.16, -0.3, -0.1, 0.1]
    ].forEach(([x, y, z, rx, rz]) => {
      const leg = new THREE.Mesh(legGeo, woodLegMat)
      leg.position.set(x, y, z)
      leg.rotation.x = rx
      leg.rotation.z = rz
      leg.castShadow = true
      root.add(leg)
    })

    return {
      id,
      name: config.name || '单人轻奢扶手椅',
      type: 'armchair',
      rootObject: root,
      internalParts: [{ id: 'part_armchair_pillow', name: '焦糖点缀靠枕', object: pillow }]
    }
  }

  buildCoffeeTableItem(id, config = {}) {
    const root = new THREE.Group()
    root.name = config.name || '极简实木圆茶几'
    if (config.position) root.position.set(...config.position)
    else root.position.set(0, 0, 1.1)

    const tableTopMat = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b, // 暖胡桃原木
      roughness: 0.42,
      metalness: 0.05
    })
    const trayMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // 陶瓷白托盘
      roughness: 0.25,
      metalness: 0.3
    })
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.3,
      metalness: 0.85
    })

    // 圆桌面
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 32), tableTopMat)
    tableTop.position.y = 0.42
    tableTop.castShadow = true
    tableTop.receiveShadow = true
    root.add(tableTop)

    // 上层摆件托盘 (可内部独立旋转/移动)
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.025, 24), trayMat)
    tray.position.set(-0.12, 0.45, 0.05)
    tray.castShadow = true
    root.add(tray)

    // 3 只金属细脚
    const legGeo = new THREE.CylinderGeometry(0.015, 0.012, 0.42, 16)
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(Math.cos(angle) * 0.36, 0.21, Math.sin(angle) * 0.36)
      leg.castShadow = true
      root.add(leg)
    }

    return {
      id,
      name: config.name || '极简实木圆茶几',
      type: 'table',
      rootObject: root,
      internalParts: [{ id: 'part_table_tray', name: '桌面摆件托盘', object: tray }]
    }
  }

  buildFloorLampItem(id, config = {}) {
    const root = new THREE.Group()
    root.name = config.name || '现代极简落地灯'
    if (config.position) root.position.set(...config.position)
    else root.position.set(-1.45, 0, -0.3)

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // 黄铜拉丝质感
      roughness: 0.35,
      metalness: 0.85
    })
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      roughness: 0.45,
      metalness: 0.05
    })

    // 底座
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 32), metalMat)
    base.position.y = 0.015
    base.castShadow = true
    root.add(base)

    // 灯杆
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.48, 16), metalMat)
    pole.position.y = 0.74
    pole.castShadow = true
    root.add(pole)

    // 弧形弯杆 + 可调节朝向的灯罩
    const headGroup = new THREE.Group()
    headGroup.position.set(0.18, 1.48, 0)

    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 24, 1, true), shadeMat)
    shade.rotation.x = Math.PI / 4
    shade.castShadow = true
    headGroup.add(shade)

    root.add(headGroup)

    return {
      id,
      name: config.name || '现代极简落地灯',
      type: 'lamp',
      rootObject: root,
      internalParts: [{ id: 'part_lamp_head', name: '可调灯罩朝向', object: headGroup }]
    }
  }

  /**
   * 载入外部自定义 .GLB 文件并解析子节点
   */
  loadGLBFromUrl(url, fileName = '自定义 GLB 模型') {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene || gltf.scenes[0]
          const id = 'glb_' + Date.now()

          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true
            }
          })

          // 归一化并吸附
          const box = new THREE.Box3().setFromObject(model)
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z)
          if (maxDim > 0) {
            model.scale.setScalar(1.5 / maxDim)
          }

          // 遍历提取前 5 个有意义的子网格作为内部可调节部件
          const internalParts = []
          let partIdx = 1
          model.traverse((child) => {
            if (child.isMesh && child !== model && internalParts.length < 6) {
              internalParts.push({
                id: 'part_' + partIdx,
                name: child.name || `内部构件 #${partIdx}`,
                object: child
              })
              partIdx++
            }
          })

          const itemData = {
            id,
            name: fileName,
            type: 'custom_glb',
            rootObject: model,
            internalParts
          }

          this.scene.add(model)
          this.sceneItems.push(itemData)
          this.selectItem(id, null)
          this.snapObjectToGround(model)
          resolve(itemData)
        },
        undefined,
        (err) => reject(err)
      )
    })
  }

  // ----------------------------------------------------
  // 视口交互与射线拾取
  // ----------------------------------------------------

  onPointerDown(e) {
    // 若正在使用手柄操作则不触发射线
    if (this.transformControls.dragging) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)
    const objectsToTest = this.sceneItems.map((it) => it.rootObject)
    const intersects = this.raycaster.intersectObjects(objectsToTest, true)

    if (intersects.length > 0) {
      let hit = intersects[0].object
      // 溯源找到所属的 sceneItem
      for (const item of this.sceneItems) {
        let isDescendant = false
        item.rootObject.traverse((c) => {
          if (c === hit) isDescendant = true
        })
        if (isDescendant) {
          this.selectItem(item.id, null)
          break
        }
      }
    }
  }

  handleTransformChanged() {
    const target = this.transformControls.object
    if (!target) return

    // 如果是整个根物体，约束其最低点不能跌破地面
    if (!this.selectedPartId) {
      if (target.position.y < 0) target.position.y = 0
    }

    if (this.onTransformChange) {
      this.onTransformChange(this.getCurrentTransformValues())
    }
  }

  setTransformMode(mode) {
    if (this.transformControls) {
      this.transformControls.setMode(mode)
    }
  }

  setGridVisible(visible) {
    if (this.gridHelper) {
      this.gridHelper.visible = visible
    }
  }

  // ----------------------------------------------------
  // 相机位置与导演机位控制
  // ----------------------------------------------------

  setCameraPosition(x, y, z) {
    this.camera.position.set(x, y, z)
    this.orbitControls.update()
    this.emitCameraState()
  }

  setCameraFov(fov) {
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    this.emitCameraState()
  }

  setCameraPreset(presetKey) {
    const preset = this.keyframePresets[presetKey]
    if (preset) {
      this.flyCameraTo(preset.pos, preset.target, preset.fov, 1000)
    }
  }

  flyCameraTo(posArray, targetArray, fov = 38, durationMs = 1200) {
    const startPos = this.camera.position.clone()
    const endPos = new THREE.Vector3(...posArray)
    const startTarget = this.orbitControls.target.clone()
    const endTarget = new THREE.Vector3(...targetArray)
    const startFov = this.camera.fov
    const startTime = performance.now()

    const animateFlight = (now) => {
      const p = Math.min((now - startTime) / durationMs, 1)
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p

      this.camera.position.lerpVectors(startPos, endPos, ease)
      this.orbitControls.target.lerpVectors(startTarget, endTarget, ease)
      this.camera.fov = startFov + (fov - startFov) * ease
      this.camera.updateProjectionMatrix()
      this.orbitControls.update()
      this.emitCameraState()

      if (p < 1) {
        requestAnimationFrame(animateFlight)
      }
    }
    requestAnimationFrame(animateFlight)
  }

  emitCameraState() {
    if (this.onCameraChange) {
      this.onCameraChange({
        posX: Number(this.camera.position.x.toFixed(2)),
        posY: Number(this.camera.position.y.toFixed(2)),
        posZ: Number(this.camera.position.z.toFixed(2)),
        fov: Math.round(this.camera.fov),
        distance: Number(this.camera.position.distanceTo(this.orbitControls.target).toFixed(2))
      })
    }
  }

  saveAsStartFrame() {
    this.startFrame = {
      position: this.camera.position.clone(),
      target: this.orbitControls.target.clone(),
      fov: this.camera.fov
    }
    return this.startFrame
  }

  saveAsEndFrame() {
    this.endFrame = {
      position: this.camera.position.clone(),
      target: this.orbitControls.target.clone(),
      fov: this.camera.fov
    }
    return this.endFrame
  }

  applyFrame(frameType = 'start') {
    const frame = frameType === 'start' ? this.startFrame : this.endFrame
    this.camera.position.copy(frame.position)
    this.orbitControls.target.copy(frame.target)
    this.camera.fov = frame.fov
    this.camera.updateProjectionMatrix()
    this.orbitControls.update()
    this.emitCameraState()
  }

  playDirectorPreview(durationMs = 4500, onProgress = null, onComplete = null) {
    if (this.isDirectingPreview) return
    this.isDirectingPreview = true
    this.transformControls.enabled = false
    this.orbitControls.enabled = false

    const startTime = performance.now()
    const startPos = this.startFrame.position.clone()
    const endPos = this.endFrame.position.clone()
    const startTarget = this.startFrame.target.clone()
    const endTarget = this.endFrame.target.clone()
    const startFov = this.startFrame.fov
    const endFov = this.endFrame.fov

    const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

    const animateStep = (now) => {
      const elapsed = now - startTime
      const rawProgress = Math.min(elapsed / durationMs, 1)
      const t = easeInOutCubic(rawProgress)

      this.camera.position.lerpVectors(startPos, endPos, t)
      this.orbitControls.target.lerpVectors(startTarget, endTarget, t)
      this.camera.fov = startFov + (endFov - startFov) * t
      this.camera.updateProjectionMatrix()
      this.orbitControls.update()
      this.emitCameraState()

      if (onProgress) onProgress(rawProgress)

      if (rawProgress < 1) {
        requestAnimationFrame(animateStep)
      } else {
        this.isDirectingPreview = false
        this.transformControls.enabled = true
        this.orbitControls.enabled = true
        if (onComplete) onComplete()
      }
    }
    requestAnimationFrame(animateStep)
  }

  calculateCameraMotion() {
    const p1 = this.startFrame.position
    const p2 = this.endFrame.position
    return {
      panX: Number((p2.x - p1.x).toFixed(3)),
      panY: Number((p2.y - p1.y).toFixed(3)),
      zoomZ: Number((p2.z - p1.z).toFixed(3)),
      zoomRatio: Number((this.startFrame.fov / this.endFrame.fov).toFixed(2)),
      durationSeconds: 5
    }
  }

  captureCompositeFrame(bgImg) {
    const offCanvas = document.createElement('canvas')
    offCanvas.width = this.width
    offCanvas.height = this.height
    const ctx = offCanvas.getContext('2d')

    if (bgImg) {
      ctx.drawImage(bgImg, 0, 0, this.width, this.height)
    }

    const prevGridVis = this.gridHelper ? this.gridHelper.visible : false
    if (this.gridHelper) this.gridHelper.visible = false
    this.transformControls.visible = false

    this.renderer.render(this.scene, this.camera)
    ctx.drawImage(this.renderer.domElement, 0, 0, this.width, this.height)

    if (this.gridHelper) this.gridHelper.visible = prevGridVis
    this.transformControls.visible = true

    return offCanvas.toDataURL('image/png')
  }

  renderLoop() {
    this.animFrameId = requestAnimationFrame(this.renderLoop)
    if (this.orbitControls && !this.isDirectingPreview) {
      this.orbitControls.update()
    }
    this.renderer.render(this.scene, this.camera)
  }

  handleResize() {
    if (!this.container) return
    this.width = this.container.clientWidth || 800
    this.height = this.container.clientHeight || 500
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.width, this.height)
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId)
    window.removeEventListener('resize', this.handleResize)
    if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
    if (this.orbitControls) this.orbitControls.dispose()
    if (this.transformControls) this.transformControls.dispose()
  }
}
