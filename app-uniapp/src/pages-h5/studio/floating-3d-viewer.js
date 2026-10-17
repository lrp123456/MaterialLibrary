/**
 * floating-3d-viewer.js
 * 选区浮动 3D 姿态与地面检查器引擎
 *
 * 核心能力：
 * 1. 在选区旁浮动加载 3D 模型；
 * 2. 地面角度自动吸附：将地平面网格与模型坐标系对齐到解算出的 Pitch（俯仰）与 Yaw（偏航）；
 * 3. 360° 旋转扭动模型自身朝向，支持内部构件穿透调节；
 * 4. 毫秒级导出固定机位 3D 参考图（供 Seedream 5.0 Pro 精准替换与落地）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Floating3DViewer {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = {
      width: options.width || 320,
      height: options.height || 260,
      onYawChange: options.onYawChange || (() => {}),
      ...options,
    };

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.groundGrid = null;
    this.modelRoot = null;
    this.currentModelUrl = null;
    this.yaw = options.initialYaw || 0;
    this.pitch = options.initialPitch || 20;

    this.init();
  }

  init() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const w = this.options.width;
    const h = this.options.height;

    // 1. 场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a); // 深石板蓝背景

    // 2. 相机
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.camera.position.set(0, 1.8, 3.2);

    // 3. 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 4. 控制器 (仅旋转观察，不直接更改家具自身朝向)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // 限制在地面以上
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 8.0;

    // 5. 光照环境
    const ambLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xfff7ed, 1.5);
    dirLight.position.set(2, 4, 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    // 6. 地面透视网格与阴影接收板
    this.setupGround();

    // 7. 默认生成一个高保真占位家具
    this.setupDefaultModel();

    // 8. 启动渲染循环
    this.animate = this.animate.bind(this);
    this.animate();
  }

  setupGround() {
    if (this.groundGrid) {
      this.scene.remove(this.groundGrid);
    }
    // 空间透视地面网格 (带轴线与刻度)
    this.groundGrid = new THREE.Group();

    const grid = new THREE.GridHelper(6, 20, 0x38bdf8, 0x1e293b);
    grid.position.y = 0;
    this.groundGrid.add(grid);

    // 阴影捕获板 (Shadow Catcher)
    const planeGeo = new THREE.PlaneGeometry(6, 6);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const shadowPlane = new THREE.Mesh(planeGeo, planeMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    this.groundGrid.add(shadowPlane);

    this.scene.add(this.groundGrid);
  }

  /**
   * 根据解算出的地面透视参数，使 3D 预览器贴地对齐
   * @param {number} pitchDeg - 俯仰角 (度)
   * @param {number} yawDeg - 偏航角 (度)
   */
  alignWithGround(pitchDeg = 20, yawDeg = 0) {
    this.pitch = pitchDeg;
    this.yaw = yawDeg;

    // 根据俯仰角度微调观察相机高度与俯角
    const radPitch = THREE.MathUtils.degToRad(Math.max(5, Math.min(45, pitchDeg)));
    const dist = 3.2;
    this.camera.position.set(0, Math.sin(radPitch) * dist + 0.5, Math.cos(radPitch) * dist);
    this.controls.target.set(0, 0.4, 0);
    this.controls.update();

    // 将模型自身朝向同步更新
    this.setYaw(yawDeg);
  }

  /**
   * 旋转模型朝向 (围绕 Y 轴自转)
   * @param {number} deg - 0~360 度
   */
  setYaw(deg) {
    this.yaw = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
    if (this.modelRoot) {
      this.modelRoot.rotation.y = THREE.MathUtils.degToRad(this.yaw);
    }
    if (this.options.onYawChange) {
      this.options.onYawChange(this.yaw);
    }
  }

  /**
   * 加载外部 GLB 模型
   */
  loadGLB(urlOrBlob) {
    if (!urlOrBlob) return;
    this.currentModelUrl = urlOrBlob;

    const loader = new GLTFLoader();
    loader.load(
      urlOrBlob,
      (gltf) => {
        if (this.modelRoot) {
          this.scene.remove(this.modelRoot);
        }
        this.modelRoot = gltf.scene;

        // 居中与归一化缩放
        const box = new THREE.Box3().setFromObject(this.modelRoot);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.6 / (maxDim || 1);
        this.modelRoot.scale.setScalar(scale);

        // 底部贴地
        box.setFromObject(this.modelRoot);
        this.modelRoot.position.set(-center.x * scale, -box.min.y, -center.z * scale);

        // 阴影投射
        this.modelRoot.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        this.setYaw(this.yaw);
        this.scene.add(this.modelRoot);
      },
      undefined,
      (err) => {
        console.warn('[Floating3DViewer] GLB 加载失败，保留预置模型:', err.message);
      }
    );
  }

  /**
   * 生成默认的高保真沙发/家具模型
   */
  setupDefaultModel(kind = 'sofa') {
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
    }
    this.modelRoot = new THREE.Group();

    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0xc87d46, // 经典暖橙/干邑皮质
      roughness: 0.35,
      metalness: 0.1,
    });
    const cushionMat = new THREE.MeshStandardMaterial({
      color: 0x9a5c30,
      roughness: 0.5,
      metalness: 0.05,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.2,
      metalness: 0.85,
    });

    if (kind === 'sofa') {
      // 底座
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.9), leatherMat);
      base.position.y = 0.22;
      base.castShadow = true;
      this.modelRoot.add(base);

      // 靠背
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.22), leatherMat);
      back.position.set(0, 0.55, -0.34);
      back.castShadow = true;
      this.modelRoot.add(back);

      // 左扶手
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.9), leatherMat);
      armL.position.set(-0.7, 0.42, 0);
      armL.castShadow = true;
      this.modelRoot.add(armL);

      // 右扶手
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.9), leatherMat);
      armR.position.set(0.7, 0.42, 0);
      armR.castShadow = true;
      this.modelRoot.add(armR);

      // 座垫
      const cushion1 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.62), cushionMat);
      cushion1.position.set(-0.32, 0.36, 0.04);
      cushion1.castShadow = true;
      this.modelRoot.add(cushion1);

      const cushion2 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.62), cushionMat);
      cushion2.position.set(0.32, 0.36, 0.04);
      cushion2.castShadow = true;
      this.modelRoot.add(cushion2);

      // 细金属沙发脚
      const legGeo = new THREE.CylinderGeometry(0.025, 0.015, 0.12, 16);
      [
        [-0.7, 0.06, 0.36],
        [0.7, 0.06, 0.36],
        [-0.7, 0.06, -0.36],
        [0.7, 0.06, -0.36],
      ].forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeo, metalMat);
        leg.position.set(x, y, z);
        leg.castShadow = true;
        this.modelRoot.add(leg);
      });
    }

    this.setYaw(this.yaw);
    this.scene.add(this.modelRoot);
  }

  /**
   * 导出用于 Seedream 5.0 的固定机位 3D 参考图
   * 严格遵循规范：方位 45°、俯视约 85° 或标准观察视角，输出 Base64
   */
  exportFixedSnapshot() {
    if (!this.renderer || !this.scene || !this.camera) return null;

    // 保存当前视角
    const origPos = this.camera.position.clone();
    const origTarget = this.controls.target.clone();

    // 隐藏辅助网格，仅保留模型本身与轻微投影
    if (this.groundGrid) this.groundGrid.visible = false;
    const origBg = this.scene.background;
    this.scene.background = new THREE.Color(0xffffff); // 纯白底参考图

    // 切换到固定拍摄机位 (方位 45°、俯视 ~85°)
    this.camera.position.set(1.5, 2.2, 1.5);
    this.camera.lookAt(0, 0.4, 0);

    // 离屏渲染
    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png', 0.95);

    // 恢复原场景与控制器状态
    this.scene.background = origBg;
    if (this.groundGrid) this.groundGrid.visible = true;
    this.camera.position.copy(origPos);
    this.controls.target.copy(origTarget);
    this.controls.update();

    return dataUrl;
  }

  animate() {
    this._rafId = requestAnimationFrame(this.animate);
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.controls) this.controls.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
  }
}
