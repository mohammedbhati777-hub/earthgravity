import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useStore, planetM, planetR, moonM, moonDist, type CameraMode } from "../state/store";
import world, { advance, setEnv, viewState, moonPos, telemetry } from "../state/world";
import { EARTH, vLen, vNorm, gravAccel, escapeV, circV, fmt, fmtKm, clamp } from "../physics/core";
import { getTexture } from "./textures";

const UNIT = EARTH.R; // 1 scene unit = 1 Earth radius (6371 km)
const s = (m: number) => m / UNIT;

function usePlanetVis() {
  const st = useStore();
  return {
    M: planetM(st), R: planetR(st), rotMult: st.rotMult,
    visR: planetR(st) / UNIT,
    focus: st.focusBody,
  };
}

/* ================= EARTH ================= */
const earthVert = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const earthFrag = `
uniform sampler2D dayMap; uniform sampler2D nightMap;
uniform vec3 sunDir; uniform float heatMix;
uniform float uG0; uniform float uCen; uniform float uF; uniform float uGmin; uniform float uGrange;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
vec3 ramp(float t){
  vec3 c1=vec3(0.05,0.15,0.45); vec3 c2=vec3(0.1,0.75,0.95);
  vec3 c3=vec3(1.0,0.75,0.25); vec3 c4=vec3(1.0,0.28,0.18);
  if(t<0.33) return mix(c1,c2,t/0.33);
  if(t<0.66) return mix(c2,c3,(t-0.33)/0.33);
  return mix(c3,c4,(t-0.66)/0.34);
}
void main(){
  vec3 n=normalize(vN); vec3 sd=normalize(sunDir);
  vec3 view=normalize(cameraPosition-vW);
  float ndl=dot(n,sd);
  vec4 day=texture2D(dayMap,vUv); vec4 night=texture2D(nightMap,vUv);
  float dm=smoothstep(-0.14,0.22,ndl);
  float ocean=step(0.06,day.b-day.r)*step(0.2,day.b);
  vec3 spec=pow(max(dot(reflect(-sd,n),view),0.0),26.0)*ocean*dm*vec3(0.55,0.75,0.9)*0.7;
  vec3 col=mix(night.rgb*1.35+vec3(0.008,0.012,0.03), day.rgb, dm)+spec;
  float rim=pow(1.0-max(dot(n,view),0.0),2.6);
  col+=vec3(0.16,0.42,0.62)*rim*0.55*(0.35+0.65*dm);
  if(heatMix>0.001){
    float sinLat=(vUv.y-0.5)*2.0;
    float cos2=1.0-sinLat*sinLat;
    float rr=1.0-uF*sinLat*sinLat;
    float g=uG0/(rr*rr)-uCen*cos2;
    float t=clamp((g-uGmin)/max(uGrange,0.0001),0.0,1.0);
    col=mix(col, ramp(t), heatMix*0.75);
  }
  gl_FragColor=vec4(col,1.0);
}`;

function Earth() {
  const { visR, focus, M, R } = usePlanetVis();
  const rotMult = useStore((x) => x.rotMult);
  const setSite = useStore((x) => x.setSite);
  const atmosphere = useStore((x) => x.atmosphere);
  const site = useStore((x) => x.site);
  const grp = useRef<THREE.Group>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const sunDir = useMemo(() => new THREE.Vector3(1, 0.18, 0.35).normalize(), []);

  const texBody = focus === "custom" ? "mars" : focus;
  const day = useMemo(() => getTexture(texBody, "day"), [texBody]);
  const night = useMemo(() => getTexture(focus === "earth" ? "earth" : texBody, "night"), [texBody, focus]);
  const cloudTex = useMemo(() => getTexture("earth", "clouds"), []);

  const uniforms = useMemo(
    () => ({ dayMap: { value: day }, nightMap: { value: focus === "earth" ? night : day }, sunDir: { value: sunDir }, heatMix: { value: 0 }, uG0: { value: 9.8 }, uCen: { value: 0.034 }, uF: { value: 0.00335 }, uGmin: { value: 9.78 }, uGrange: { value: 0.05 } }),
    [day, night, focus, sunDir]
  );

  useFrame((_, dt) => {
    if (grp.current) grp.current.rotation.y += dt * 0.05 * rotMult * 8; // rotation visualized ×~700, scales with multiplier
    if (clouds.current) clouds.current.rotation.y += dt * 0.062 * rotMult * 8;
    // surface gravity heat map driver (educational rotating-Earth model)
    const st = useStore.getState();
    const M = planetM(st), R = planetR(st), T = 86164.0905 / st.rotMult;
    const g0 = (6.674e-11 * M) / (R * R);
    const om = (2 * Math.PI) / T;
    const rotF = 86164.0905 / T;
    const f = Math.min(0.22, (1 / 298.257) * rotF * rotF * 6);
    let gmin = Infinity, gmax = -Infinity;
    for (let lat = 0; lat <= 90; lat += 5) {
      const s = Math.sin((lat * Math.PI) / 180) ** 2;
      const rr = 1 - f * s;
      const g = g0 / (rr * rr) - om * om * R * rr * (1 - s);
      if (g < gmin) gmin = g;
      if (g > gmax) gmax = g;
    }
    uniforms.uG0.value = st.surfaceHeat === "SPHERE" ? g0 : g0;
    uniforms.uCen.value = st.surfaceHeat === "SPHERE" ? 0 : om * om * R;
    uniforms.uF.value = st.surfaceHeat === "SPHERE" ? 0 : f;
    uniforms.uGmin.value = st.surfaceHeat === "SPHERE" ? g0 * 0.9995 : gmin;
    uniforms.uGrange.value = st.surfaceHeat === "SPHERE" ? g0 * 0.001 : Math.max(gmax - gmin, 1e-6);
    const target = st.surfaceHeat === "OFF" ? 0 : 0.85;
    uniforms.heatMix.value += (target - uniforms.heatMix.value) * Math.min(1, dt * 3);
  });

  const onPick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const local = grp.current ? grp.current.worldToLocal(e.point.clone()) : e.point.clone();
    const p = vNorm({ x: local.x, y: local.y, z: local.z });
    const lat = Math.asin(clamp(p.y, -1, 1)) * (180 / Math.PI);
    const lon = Math.atan2(p.z, p.x) * (180 / Math.PI);
    setSite({ lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 });
  };

  const sitePos = useMemo(() => {
    if (!site) return null;
    const phi = (site.lat * Math.PI) / 180, th = (site.lon * Math.PI) / 180;
    return new THREE.Vector3(Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th)).multiplyScalar(visR * 1.005);
  }, [site, visR]);

  const isEarth = focus === "earth" || focus === "custom";
  void M; void R;

  return (
    <group>
      <group ref={grp}>
        <mesh onPointerDown={onPick}>
          <sphereGeometry args={[visR, 96, 64]} />
          <shaderMaterial vertexShader={earthVert} fragmentShader={earthFrag} uniforms={uniforms} />
        </mesh>
        {isEarth && atmosphere && (
          <mesh ref={clouds}>
            <sphereGeometry args={[visR * 1.014, 72, 48]} />
            <meshLambertMaterial map={cloudTex} transparent opacity={0.85} depthWrite={false} color="#ffffff" />
          </mesh>
        )}
        {/* lat/lon instrument grid */}
        <mesh>
          <sphereGeometry args={[visR * 1.002, 24, 16]} />
          <meshBasicMaterial wireframe color="#5fe0ff" transparent opacity={0.055} />
        </mesh>
        {sitePos && (
          <group position={sitePos} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sitePos.clone().normalize())}>
            <mesh position={[0, 0.02, 0]}>
              <coneGeometry args={[0.014, 0.05, 8]} />
              <meshBasicMaterial color="#ffb648" />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.02, 0.028, 32]} />
              <meshBasicMaterial color="#ffb648" side={THREE.DoubleSide} transparent opacity={0.9} />
            </mesh>
          </group>
        )}
      </group>
      {/* atmosphere glow */}
      {isEarth && atmosphere && (
        <mesh>
          <sphereGeometry args={[visR * 1.16, 64, 48]} />
          <shaderMaterial
            side={THREE.BackSide} transparent blending={THREE.AdditiveBlending} depthWrite={false}
            vertexShader={`varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.); }`}
            fragmentShader={`varying vec3 vN; varying vec3 vW; void main(){ vec3 v=normalize(cameraPosition-vW); float i=pow(max(0.62-dot(normalize(vN),v),0.0),3.2); gl_FragColor=vec4(0.28,0.62,1.0,1.0)*i*1.15; }`}
          />
        </mesh>
      )}
      {/* polar axis */}
      <Line points={[[0, -visR * 1.5, 0], [0, visR * 1.5, 0]]} color="#5fe0ff" transparent opacity={0.22} lineWidth={1} dashed dashSize={0.06} gapSize={0.05} />
    </group>
  );
}

/* ================= MOON + TIDES ================= */
function MoonSystem() {
  const st = useStore();
  const { visR } = usePlanetVis();
  const grp = useRef<THREE.Group>(null);
  const bulge = useRef<THREE.Mesh>(null);
  const moonTex = useMemo(() => getTexture("moon", "day"), []);
  const d = s(moonDist(st));
  const mR = Math.max(0.12, s(1.7374e6) * Math.cbrt(st.moonMassMult));

  useFrame(() => {
    if (grp.current) grp.current.rotation.y = world.moonAngle;
    if (bulge.current) {
      const tidal = (2 * 6.674e-11 * moonM(st) * planetR(st)) / moonDist(st) ** 3;
      const k = clamp(tidal * 42000, 0.004, 0.22);
      bulge.current.rotation.y = world.moonAngle;
      bulge.current.scale.set(1 + 2 * k, 1 - k * 0.8, 1 + 2 * k);
    }
  });

  if (!st.hasMoon) return null;
  return (
    <group>
      {/* tidal ocean bulge (exaggerated, labelled) */}
      <mesh ref={bulge}>
        <sphereGeometry args={[visR * 1.02, 48, 32]} />
        <meshBasicMaterial color="#3fa9ff" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <group ref={grp}>
        <group position={[d, 0, 0]}>
          <mesh>
            <sphereGeometry args={[mR, 48, 32]} />
            <meshStandardMaterial map={moonTex} roughness={0.95} />
          </mesh>
          <Html position={[0, mR + 0.5, 0]} center style={{ pointerEvents: "none" }}>
            <div className="readout text-[9px] tracking-[0.2em] text-cyan2/80 whitespace-nowrap">MOON · {fmtKm(moonDist(st))}</div>
          </Html>
        </group>
      </group>
      {/* moon orbit track */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[d - 0.01, d + 0.01, 256]} />
        <meshBasicMaterial color="#2e7fa3" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ================= ALTITUDE RINGS (draggable) ================= */
const RING_KM = [0, 100, 200, 400, 1000, 10000];
function AltitudeRings() {
  const { visR } = usePlanetVis();
  const altKm = useStore((x) => x.altKm);
  const setOrbit = useStore((x) => x.setOrbit);
  const mode = useStore((x) => x.mode);
  const [drag, setDrag] = useState(false);
  const { camera, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!drag) return;
    const up = () => setDrag(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [drag]);

  const active = mode === "ORBIT" || mode === "FIELD";
  if (!active) return null;

  return (
    <group>
      {drag && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            e.stopPropagation();
            raycaster.ray.intersectPlane(plane, hit);
            const rr = Math.hypot(hit.x, hit.z);
            const kmv = clamp(((rr - visR) * UNIT) / 1000, 0, 20000);
            setOrbit({ altKm: Math.round(kmv) });
          }}
        >
          <circleGeometry args={[50, 48]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {RING_KM.map((km) => {
        const r = visR + s(km * 1000);
        const isSel = Math.abs(altKm - km) < (km === 0 ? 60 : km * 0.12);
        return (
          <mesh
            key={km}
            rotation={[Math.PI / 2, 0, 0]}
            onPointerDown={(e) => {
              e.stopPropagation();
              setOrbit({ altKm: km });
              setDrag(true);
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              e.stopPropagation();
              raycaster.ray.intersectPlane(plane, hit);
              const rr = Math.hypot(hit.x, hit.z);
              const kmv = clamp((rr - visR) * UNIT / 1000, 0, 20000);
              setOrbit({ altKm: Math.round(kmv) });
            }}
          >
            <ringGeometry args={[r - 0.006, r + 0.006, 220]} />
            <meshBasicMaterial color={isSel ? "#ffb648" : "#2e7fa3"} transparent opacity={isSel ? 0.9 : 0.32} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
      {RING_KM.filter((k) => k > 0).map((km) => (
        <Html key={`l${km}`} position={[visR + s(km * 1000), 0.02, 0]} style={{ pointerEvents: "none" }}>
          <div className="readout text-[8px] text-cyan2/60 tracking-widest">{km >= 1000 ? `${km / 1000}k` : km}km</div>
        </Html>
      ))}
    </group>
  );
}

/* ================= GRAVITY FIELD VISUALIZATION ================= */
function FieldVis() {
  const { visR, M } = usePlanetVis();
  const fieldVis = useStore((x) => x.fieldVis);
  const density = useStore((x) => x.fieldDensity);
  const planeSel = useStore((x) => x.fieldPlane);
  const mode = useStore((x) => x.mode);

  const arrows = useMemo(() => {
    const list: { p: THREE.Vector3; dir: THREE.Vector3; len: number; t: number }[] = [];
    const surfG = gravAccel(M, visR * UNIT);
    if (planeSel !== "OFF") {
      const n = Math.round(density * 4) + 3;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const a = (i / n) * visR * 3.4, b = (j / n) * visR * 3.4;
        let p = new THREE.Vector3();
        if (planeSel === "XY") p.set(a, b, 0);
        else if (planeSel === "XZ") p.set(a, 0, b);
        else p.set(0, a, b);
        const d = p.length();
        if (d < visR * 1.06 || d > visR * 3.6) continue;
        const g = gravAccel(M, d * UNIT);
        const t = clamp(g / surfG, 0, 1);
        list.push({ p, dir: p.clone().normalize().negate(), len: 0.12 + t * 0.55, t });
      }
    } else if (fieldVis === "VECTORS") {
      const count = density * 30;
      for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2;
        const rad = Math.sqrt(1 - y * y);
        const phi = i * 2.39996;
        for (const rr of [1.55, 2.35, 3.2]) {
          const p = new THREE.Vector3(Math.cos(phi) * rad, y, Math.sin(phi) * rad).multiplyScalar(visR * rr);
          const g = gravAccel(M, p.length() * UNIT);
          const t = clamp(g / surfG, 0, 1);
          list.push({ p, dir: p.clone().normalize().negate(), len: 0.12 + t * 0.55, t });
        }
      }
    } else if (fieldVis === "LINES") {
      const count = density * 10;
      for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = i * 2.39996;
        const dir = new THREE.Vector3(Math.cos(phi) * rad, y, Math.sin(phi) * rad);
        const p0 = dir.clone().multiplyScalar(visR * 1.03);
        const p1 = dir.clone().multiplyScalar(visR * (1.03 + 1.9));
        list.push({ p: p0.clone().lerp(p1, 0.5), dir: dir.clone().negate(), len: 0, t: 0 });
        (list[list.length - 1] as any).line = [p0.toArray(), p1.toArray()];
      }
    }
    return list;
  }, [fieldVis, density, planeSel, visR, M]);

  const heatUniforms = useMemo(
    () => ({ uR: { value: visR }, uCam: { value: new THREE.Vector3() } }),
    [visR]
  );

  if (mode !== "FIELD") return null;

  return (
    <group>
      {/* slice plane */}
      {planeSel !== "OFF" && (
        <mesh rotation={planeSel === "XY" ? [0, 0, 0] : planeSel === "XZ" ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]}>
          <planeGeometry args={[visR * 7.2, visR * 7.2]} />
          <meshBasicMaterial color="#1d3350" transparent opacity={0.1} side={THREE.DoubleSide} wireframe />
        </mesh>
      )}
      {/* instanced arrow cones */}
      {arrows.filter((a) => a.len > 0).length > 0 && <ArrowField arrows={arrows.filter((a) => a.len > 0)} />}
      {/* field lines */}
      {fieldVis === "LINES" && planeSel === "OFF" &&
        arrows.map((a: any, i) => a.line && (
          <group key={i}>
            <Line points={a.line} color="#4cc0e8" transparent opacity={0.4} lineWidth={1} />
            <mesh position={a.line[1]} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...a.dir))}>
              <coneGeometry args={[0.028, 0.09, 8]} />
              <meshBasicMaterial color="#9beaff" />
            </mesh>
          </group>
        ))}
      {/* heat shell */}
      {fieldVis === "HEAT" && (
        <mesh>
          <sphereGeometry args={[visR * 4.6, 48, 32]} />
          <shaderMaterial
            transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} uniforms={heatUniforms}
            vertexShader={`varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.); }`}
            fragmentShader={`uniform float uR; varying vec3 vW;
              vec3 ramp(float t){ return t<0.5? mix(vec3(0.03,0.1,0.4),vec3(0.1,0.8,0.95),t*2.0) : mix(vec3(0.1,0.8,0.95),vec3(1.0,0.45,0.15),(t-0.5)*2.0); }
              void main(){ float d=length(vW); float t=clamp(pow(uR/max(d,0.001),2.0),0.0,1.0); float a=0.045+t*0.30; gl_FragColor=vec4(ramp(t),a); }`}
          />
        </mesh>
      )}
    </group>
  );
}

function ArrowField({ arrows }: { arrows: { p: THREE.Vector3; dir: THREE.Vector3; len: number; t: number }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    arrows.forEach((a, i) => {
      q.setFromUnitVectors(up, a.dir.clone().negate());
      m.compose(a.p.clone().add(a.dir.clone().multiplyScalar(-a.len / 2)), q, new THREE.Vector3(0.5, a.len, 0.5));
      ref.current!.setMatrixAt(i, m);
      col.setHSL(0.55 - a.t * 0.45, 0.9, 0.45 + a.t * 0.2);
      ref.current!.setColorAt(i, col);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [arrows]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, arrows.length]}>
      <coneGeometry args={[0.05, 1, 8]} />
      <meshBasicMaterial transparent opacity={0.85} />
    </instancedMesh>
  );
}

/* ================= SPACECRAFT + TRAILS ================= */
function Craft() {
  const mesh = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Line>(null);
  const predRef = useRef<THREE.Line>(null);
  const ringArc = useRef<THREE.Line>(null);

  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(7000 * 3), 3));
    g.setDrawRange(0, 0);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x5fe0ff, transparent: true, opacity: 0.8 }));
  }, []);
  const pred = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    g.setDrawRange(0, 0);
    const m = new THREE.LineDashedMaterial({ color: 0xffb648, transparent: true, opacity: 0.75, dashSize: 0.08, gapSize: 0.06 });
    return new THREE.Line(g, m);
  }, []);
  const arc = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(97 * 3), 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.9 }));
  }, []);

  useFrame(() => {
    const st = viewState();
    if (mesh.current) {
      mesh.current.position.set(s(st.pos.x), s(st.pos.y), s(st.pos.z));
      mesh.current.visible = world.launched;
    }
    // trail
    const h = world.history;
    const upto = world.scrub != null ? Math.min(world.scrub + 1, h.length) : h.length;
    const attr = trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = Math.min(upto, useStore.getState().trailLen);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = s(h[i].pos.x); arr[i * 3 + 1] = s(h[i].pos.y); arr[i * 3 + 2] = s(h[i].pos.z);
    }
    attr.needsUpdate = true;
    trail.geometry.setDrawRange(0, n);
    // prediction
    const p = world.prediction;
    const pattr = pred.geometry.getAttribute("position") as THREE.BufferAttribute;
    const parr = pattr.array as Float32Array;
    const pn = Math.min(p.length, 400);
    for (let i = 0; i < pn; i++) {
      parr[i * 3] = s(p[i].x); parr[i * 3 + 1] = s(p[i].y); parr[i * 3 + 2] = s(p[i].z);
    }
    pattr.needsUpdate = true;
    pred.geometry.setDrawRange(0, pn);
    pred.computeLineDistances();
    // circular-velocity comparison arc at current radius
    const r = vLen(st.pos);
    const frac = clamp(vLen(st.vel) / circV(planetM(useStore.getState()), r), 0.02, 2) / 2;
    const rr = s(r);
    const aattr = arc.geometry.getAttribute("position") as THREE.BufferAttribute;
    const aarr = aattr.array as Float32Array;
    for (let i = 0; i < 97; i++) {
      const a = (i / 96) * Math.PI * 2 * frac;
      const base = Math.atan2(st.pos.z, st.pos.x);
      aarr[i * 3] = Math.cos(base + a) * rr; aarr[i * 3 + 1] = 0; aarr[i * 3 + 2] = Math.sin(base + a) * rr;
    }
    aattr.needsUpdate = true;
    arc.visible = world.launched && world.alive;
  });

  return (
    <group>
      <primitive object={trail} ref={trailRef} />
      <primitive object={pred} ref={predRef} />
      <primitive object={arc} ref={ringArc} />
      <group ref={mesh}>
        <mesh rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.018, 0.07, 10]} />
          <meshStandardMaterial color="#e6f2fb" emissive="#5fe0ff" emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
        </mesh>
        <pointLight color="#5fe0ff" intensity={0.4} distance={0.6} />
      </group>
    </group>
  );
}

/* ================= GRAVITY PROBE (draggable) ================= */
function GravityProbe() {
  const probe = useStore((x) => x.probe);
  const setProbe = useStore((x) => x.setProbe);
  const { visR, M } = usePlanetVis();
  const [drag, setDrag] = useState(false);
  const { camera, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(), []);
  const pt = useMemo(() => new THREE.Vector3(), []);

  const r = vLen(probe) * UNIT;
  const g = gravAccel(M, r);

  useEffect(() => {
    if (!drag) return;
    const up = () => setDrag(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [drag]);

  useFrame(() => {
    if (!drag) return;
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(pt).negate(), new THREE.Vector3(probe.x, probe.y, probe.z));
    if (raycaster.ray.intersectPlane(plane, pt)) {
      let v = { x: pt.x, y: pt.y, z: pt.z };
      const l = vLen(v);
      const min = visR * 1.03, max = 130;
      if (l < min) v = { x: (v.x / l) * min, y: (v.y / l) * min, z: (v.z / l) * min };
      if (l > max) v = { x: (v.x / l) * max, y: (v.y / l) * max, z: (v.z / l) * max };
      setProbe(v);
    }
  });

  return (
    <group position={[probe.x, probe.y, probe.z]}>
      <mesh
        onPointerDown={(e) => { e.stopPropagation(); setDrag(true); (e.target as any).setPointerCapture?.(e.pointerId); }}
        onPointerUp={() => setDrag(false)}
      >
        <sphereGeometry args={[0.045, 20, 16]} />
        <meshStandardMaterial color="#ffb648" emissive="#ffb648" emissiveIntensity={0.9} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.075, 16, 12]} />
        <meshBasicMaterial color="#ffb648" wireframe transparent opacity={0.4} />
      </mesh>
      <Html position={[0.12, 0.12, 0]} style={{ pointerEvents: "none" }}>
        <div className="readout text-[9px] leading-tight text-amber2 whitespace-nowrap" style={{ textShadow: "0 0 8px rgba(0,0,0,0.9)" }}>
          <div className="lbl !text-amber/70">GRAVITY PROBE</div>
          <div>r {fmtKm(r)}</div>
          <div>g {fmt(g, 3)} m/s²</div>
          <div>vₑ {fmt(escapeV(M, r) / 1000, 2)} km/s</div>
        </div>
      </Html>
    </group>
  );
}

/* ================= SUN MARKER ================= */
function SunMarker() {
  return (
    <group position={[330, 8, 40]}>
      <mesh>
        <sphereGeometry args={[7, 24, 16]} />
        <meshBasicMaterial color="#ffd98a" />
      </mesh>
      <pointLight intensity={2} distance={1200} decay={0.4} color="#fff2d8" />
      <Html position={[0, 11, 0]} center style={{ pointerEvents: "none" }}>
        <div className="readout text-[9px] tracking-[0.25em] text-amber2/70 whitespace-nowrap">SUN · DIRECTION ONLY, NOT TO SCALE</div>
      </Html>
    </group>
  );
}

/* ================= CAMERA RIG ================= */
function CameraRig() {
  const cameraMode = useStore((x) => x.camera);
  const site = useStore((x) => x.site);
  const { visR } = usePlanetVis();
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(visR * 2.2, visR * 1.2, visR * 3.1);
  }, [visR, camera]);

  useFrame(() => {
    const st = useStore.getState();
    const R = visR;
    if (cameraMode === "ORBIT" && world.launched) {
      const p = viewState().pos;
      tgt.set(s(p.x), s(p.y), s(p.z));
      const alt = vLen(p) - planetR(st);
      desired.copy(tgt).add(new THREE.Vector3(0.4, 0.3, 0.8).multiplyScalar(clamp(s(alt) * 2 + 0.5, 0.5, 8)));
    } else if (cameraMode === "SURFACE" && site) {
      const phi = (site.lat * Math.PI) / 180, th = (site.lon * Math.PI) / 180;
      const up = new THREE.Vector3(Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th));
      tgt.copy(up).multiplyScalar(R);
      desired.copy(up).multiplyScalar(R * 1.06).add(new THREE.Vector3(0, R * 0.12, 0));
    } else if (cameraMode === "DEEP") {
      tgt.set(0, 0, 0);
      desired.set(40, 55, 95);
    } else if (cameraMode === "FIELD") {
      tgt.set(0, 0, 0);
      desired.set(R * 2.6, R * 3.6, R * 4.4);
    } else {
      tgt.set(0, 0, 0);
      desired.set(R * 2.1, R * 1.05, R * 3.2);
    }
    const k = 1 - Math.pow(0.0025, 1 / 60);
    camera.position.lerp(desired, k * 1.6);
    if (controls.current) {
      controls.current.target.lerp(tgt, k * 2.2);
      controls.current.minDistance = R * 1.12;
      controls.current.maxDistance = 500;
      controls.current.update();
    }
  });

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} rotateSpeed={0.55} />;
}

/* ================= ENV SYNC + MAIN LOOP ================= */
function Engine() {
  useEffect(() => {
    const unsub = useStore.subscribe((st, prev) => {
      if (
        st.massMult !== prev.massMult || st.radiusMult !== prev.radiusMult || st.rotMult !== prev.rotMult ||
        st.focusBody !== prev.focusBody || st.hasMoon !== prev.hasMoon || st.moonMassMult !== prev.moonMassMult ||
        st.moonDistMult !== prev.moonDistMult || st.moonSpeedMult !== prev.moonSpeedMult ||
        st.moonGrav !== prev.moonGrav || st.sunGrav !== prev.sunGrav || st.dragModel !== prev.dragModel ||
        st.craftMass !== prev.craftMass || st.customBody !== prev.customBody
      ) {
        setEnv({
          M: planetM(st), R: planetR(st), rotPeriod: 86164.0905 / st.rotMult,
          moonOn: st.hasMoon, moonM: moonM(st), moonDist: moonDist(st), moonSpeed: st.moonSpeedMult,
          moonGrav: st.moonGrav && st.hasMoon, sunGrav: st.sunGrav, dragOn: st.dragModel, craftMass: st.craftMass,
        });
      }
    });
    const st0 = useStore.getState();
    setEnv({
      M: planetM(st0), R: planetR(st0), rotPeriod: 86164.0905 / st0.rotMult,
      moonOn: st0.hasMoon, moonM: moonM(st0), moonDist: moonDist(st0), moonSpeed: st0.moonSpeedMult,
      moonGrav: st0.moonGrav, sunGrav: st0.sunGrav, dragOn: st0.dragModel, craftMass: st0.craftMass,
    });
    return unsub;
  }, []);

  useFrame((_, dt) => {
    const st = useStore.getState();
    advance(Math.min(dt, 0.05), st.speed, st.running);
  });
  return null;
}

/* ================= SCENE ROOT ================= */
export default function PlanetaryScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [2.2, 1.2, 3.2], fov: 45, near: 0.01, far: 2000 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={["#03060d"]} />
      <ambientLight intensity={0.16} color="#8fb8dc" />
      <directionalLight position={[330, 60, 115]} intensity={2.1} color="#fff4e0" />
      <Stars radius={400} depth={120} count={5200} factor={5} saturation={0.12} fade speed={0.4} />
      <Engine />
      <Earth />
      <MoonSystem />
      <AltitudeRings />
      <FieldVis />
      <Craft />
      <GravityProbe />
      <SunMarker />
      <CameraRig />
    </Canvas>
  );
}
export { telemetry as sceneTelemetry };
