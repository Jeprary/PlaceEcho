import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type HeroObjectProps = {
  assetUrl: string;
};

export function HeroObject({ assetUrl }: HeroObjectProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let animationFrame = 0;
    let hero: Group | null = null;
    let mixer: AnimationMixer | null = null;
    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.01, 100);
    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    const clock = new Clock();

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setClearColor(new Color(0x000000), 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.append(renderer.domElement);

    scene.add(new AmbientLight(0xd9eadf, 2.2));
    const keyLight = new DirectionalLight(0xffe2b5, 4.2);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0xa8d7c0, 2.4);
    fillLight.position.set(-4, 1, 2);
    scene.add(fillLight);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const render = () => {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.05);
      mixer?.update(delta);
      if (hero) hero.rotation.y += delta * 0.18;
      renderer.render(scene, camera);
    };
    render();

    void new GLTFLoader()
      .loadAsync(assetUrl)
      .then((gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        hero = gltf.scene;
        const bounds = new Box3().setFromObject(hero);
        const size = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z, 0.001);
        const scale = 2.1 / largestDimension;
        hero.scale.setScalar(scale);
        hero.position.set(
          -center.x * scale,
          -center.y * scale,
          -center.z * scale,
        );
        hero.rotation.y = -Math.PI / 2;
        scene.add(hero);

        camera.position.set(0, 0.18, 4.25);
        camera.lookAt(0, 0, 0);
        if (gltf.animations.length > 0) {
          mixer = new AnimationMixer(hero);
          gltf.animations.forEach((clip) => mixer?.clipAction(clip).play());
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!disposed) setStatus("failed");
      });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mixer?.stopAllAction();
      if (hero) disposeObject(hero);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [assetUrl]);

  return (
    <div
      className={`memory-hero memory-hero--${status}`}
      ref={hostRef}
      role="img"
      aria-label="这段回忆的三维物件"
    >
      {status === "loading" && <span>正在唤醒这件物品</span>}
      {status === "failed" && <span>物品暂时无法显示</span>}
    </div>
  );
}

function disposeObject(root: Group): void {
  root.traverse((object) => {
    if (!("geometry" in object)) return;
    const mesh = object as {
      geometry?: { dispose(): void };
      material?:
        | ({ dispose(): void } & Record<string, unknown>)
        | Array<{ dispose(): void } & Record<string, unknown>>;
    };
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof Texture) value.dispose();
      });
      material.dispose();
    });
  });
}
