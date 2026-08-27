/* ============================================================
   Mutable simulation world — numerical engine.
   Velocity-Verlet integration of Newtonian gravity. Nothing is
   hardcoded: trajectories emerge from F = GMm/r² each step.
   ============================================================ */
import {
  G, SUN, MOON_DEF, EARTH,
  v3, vAdd, vMul, vLen, vNorm, vCross, vSub,
  elements, airDensity, dragAccel, kinetic, potentialAt,
  type Vec3, type OrbitalElements,
} from "../physics/core";

export interface Sample {
  t: number;
  pos: Vec3;
  vel: Vec3;
  alt: number; // m above surface
  speed: number;
  K: number;
  U: number;
  E: number;
  cls: string;
}

export interface WorldEnv {
  M: number; // planet mass kg
  R: number; // planet radius m
  rotPeriod: number; // s
  moonOn: boolean;
  moonM: number;
  moonDist: number;
  moonSpeed: number;
  moonGrav: boolean;
  sunGrav: boolean;
  dragOn: boolean; // atmospheric drag model
  craftMass: number;
}

const world = {
  t: 0,
  pos: v3(EARTH.R + 400_000, 0, 0),
  vel: v3(0, 0, 0),
  launched: false,
  alive: true,
  status: "READY" as string,
  elems: null as OrbitalElements | null,
  history: [] as Sample[],
  prediction: [] as Vec3[],
  moonAngle: 0.6,
  dVUsed: 0,
  maxAlt: 0,
  maxV: 0,
  acc: 0,
  scrub: null as number | null, // history index or null = live
  lastSampleT: 0,
  version: 0,
  impacts: 0,
  launchInfo: null as null | { altKm: number; speedKms: number; angleDeg: number; lat: number; lon: number },
};
export default world;

let env: WorldEnv = {
  M: EARTH.M, R: EARTH.R, rotPeriod: EARTH.rotPeriod,
  moonOn: true, moonM: MOON_DEF.M, moonDist: MOON_DEF.dist, moonSpeed: 1,
  moonGrav: false, sunGrav: false, dragOn: false, craftMass: 500,
};
export const setEnv = (e: Partial<WorldEnv>) => {
  env = { ...env, ...e };
};
export const getEnv = () => env;

export function moonPos(): Vec3 {
  const d = env.moonDist;
  return v3(Math.cos(world.moonAngle) * d, 0, Math.sin(world.moonAngle) * d);
}

function accelAt(p: Vec3, v: Vec3): Vec3 {
  const r = vLen(p);
  let a = vMul(p, (-G * env.M) / (r * r * r));
  if (env.moonGrav && env.moonOn) {
    const mp = moonPos();
    const dm = vSub(mp, p);
    const lm = vLen(dm);
    a = vAdd(a, vMul(dm, (G * env.moonM) / (lm * lm * lm)));
  }
  if (env.sunGrav) {
    const sp = v3(SUN.dist, 0, 0);
    const ds = vSub(sp, p);
    const ls = vLen(ds);
    a = vAdd(a, vMul(ds, (G * SUN.M) / (ls * ls * ls)));
  }
  if (env.dragOn) {
    const alt = r - env.R;
    const rho = airDensity(alt);
    if (rho > 1e-12) {
      const sp = vLen(v);
      const ad = dragAccel(rho, sp, 0.5, 10, env.craftMass); // Cd 0.5, A 10 m²
      if (sp > 0) a = vAdd(a, vMul(v, -ad / sp));
    }
  }
  return a;
}

function stepVerlet(dt: number) {
  const a1 = accelAt(world.pos, world.vel);
  const np = vAdd(vAdd(world.pos, vMul(world.vel, dt)), vMul(a1, 0.5 * dt * dt));
  const a2 = accelAt(np, world.vel);
  world.vel = vAdd(world.vel, vMul(vAdd(a1, a2), 0.5 * dt));
  world.pos = np;
  world.t += dt;

  const r = vLen(np);
  const alt = r - env.R;
  if (alt > world.maxAlt) world.maxAlt = alt;
  const sp = vLen(world.vel);
  if (sp > world.maxV) world.maxV = sp;

  if (r <= env.R) {
    world.alive = false;
    world.status = "IMPACT";
    world.impacts++;
    world.pos = vMul(vNorm(np), env.R);
    world.vel = v3(0, 0, 0);
    return;
  }
  world.elems = elements(world.pos, world.vel, env.M, env.R);
  world.status = world.elems.classification;
  if (world.t - world.lastSampleT >= 4) {
    world.lastSampleT = world.t;
    pushSample();
  }
}

function pushSample() {
  const sp = vLen(world.vel);
  const r = vLen(world.pos);
  world.history.push({
    t: world.t,
    pos: { ...world.pos },
    vel: { ...world.vel },
    alt: r - env.R,
    speed: sp,
    K: kinetic(env.craftMass, sp),
    U: potentialAt(env.M, env.craftMass, r),
    E: kinetic(env.craftMass, sp) + potentialAt(env.M, env.craftMass, r),
    cls: world.status,
  });
  if (world.history.length > 7000) world.history.splice(0, 1500);
}

export function advance(realDt: number, speed: number, running: boolean) {
  // moon kinematics (visual orbit; craft feels its real Newtonian pull when enabled)
  if (env.moonOn) {
    const om = env.moonSpeed * Math.sqrt((G * (env.M + env.moonM)) / env.moonDist ** 3);
    world.moonAngle += om * realDt * speed * (running ? 1 : 0);
  }
  if (!running || !world.launched || !world.alive) return;
  world.acc += realDt * speed;
  // adaptive Verlet step: finer at slow motion, coarser at high warp
  const dt = speed <= 1 ? 0.2 : speed <= 60 ? 1 : 3;
  let n = Math.floor(world.acc / dt);
  world.acc -= n * dt;
  if (n > 3500) { n = 3500; world.acc = 0; }
  for (let i = 0; i < n; i++) {
    stepVerlet(dt);
    if (!world.alive) break;
  }
  world.version++;
}

export function launch(opts: { altM: number; speed: number; angleDeg: number; lat: number; lon: number }) {
  const { altM, speed, angleDeg, lat, lon } = opts;
  const R = env.R + altM;
  const phi = (lat * Math.PI) / 180;
  const th = (lon * Math.PI) / 180;
  const pos = v3(R * Math.cos(phi) * Math.cos(th), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(th));
  const up = vNorm(pos);
  let east = vNorm(vCross(v3(0, 1, 0), up));
  if (vLen(vCross(v3(0, 1, 0), up)) < 1e-6) east = v3(1, 0, 0);
  const ang = (angleDeg * Math.PI) / 180;
  // rotational boost: v = ω × r (eastward at latitude)
  const om = (2 * Math.PI) / env.rotPeriod;
  const vRot = om * R * Math.cos(phi);
  const horiz = vMul(east, Math.cos(ang));
  const vert = vMul(up, Math.sin(ang));
  const dir = vNorm(vAdd(horiz, vert));
  world.pos = pos;
  world.vel = vAdd(vMul(dir, speed), vMul(east, vRot));
  world.t = 0;
  world.launched = true;
  world.alive = true;
  world.status = "IN FLIGHT";
  world.history = [];
  world.prediction = [];
  world.dVUsed = Math.abs(speed) + Math.abs(vRot);
  world.maxAlt = altM;
  world.maxV = vLen(world.vel);
  world.acc = 0;
  world.lastSampleT = 0;
  world.scrub = null;
  world.impacts = 0;
  world.launchInfo = { altKm: altM / 1000, speedKms: speed / 1000, angleDeg, lat, lon };
  world.elems = elements(world.pos, world.vel, env.M, env.R);
  pushSample();
  predict();
  world.version++;
}

export function burn(dvPrograde: number) {
  if (!world.launched || !world.alive) return;
  const sp = vLen(world.vel);
  if (sp < 1) return;
  const dir = vNorm(world.vel);
  world.vel = vAdd(world.vel, vMul(dir, dvPrograde));
  world.dVUsed += Math.abs(dvPrograde);
  world.elems = elements(world.pos, world.vel, env.M, env.R);
  world.status = world.elems.classification;
  predict();
  world.version++;
}

export function predict() {
  if (!world.launched || !world.alive) { world.prediction = []; return; }
  const pts: Vec3[] = [];
  let p = { ...world.pos };
  let v = { ...world.vel };
  const dt = 8;
  const a0 = accelAt(p, v);
  let a = a0;
  for (let i = 0; i < 1400; i++) {
    const np = vAdd(vAdd(p, vMul(v, dt)), vMul(a, 0.5 * dt * dt));
    const a2 = accelAt(np, v);
    v = vAdd(v, vMul(vAdd(a, a2), 0.5 * dt));
    p = np;
    a = a2;
    if (vLen(p) <= env.R) { pts.push({ ...p }); break; }
    if (vLen(p) > env.moonDist * 1.6) { pts.push({ ...p }); break; }
    if (i % 5 === 0) pts.push({ ...p });
  }
  world.prediction = pts;
}

export function resetCraft() {
  world.launched = false;
  world.alive = true;
  world.status = "READY";
  world.history = [];
  world.prediction = [];
  world.t = 0;
  world.scrub = null;
  world.dVUsed = 0;
  world.maxAlt = 0;
  world.maxV = 0;
  world.elems = null;
  world.launchInfo = null;
  world.impacts = 0;
  world.version++;
}

export function scrubTo(idx: number | null) {
  world.scrub = idx;
  if (idx != null && world.history[idx]) {
    const s = world.history[idx];
    world.elems = elements(s.pos, s.vel, env.M, env.R);
    world.status = world.elems.classification;
  }
  world.version++;
}

/** Resume live simulation from a scrubbed history state. */
export function resumeFromScrub() {
  if (world.scrub == null) return;
  const s = world.history[world.scrub];
  if (!s) { world.scrub = null; return; }
  world.pos = { ...s.pos };
  world.vel = { ...s.vel };
  world.t = s.t;
  world.history = world.history.slice(0, world.scrub + 1);
  world.scrub = null;
  world.alive = true;
  world.launched = true;
  world.acc = 0;
  predict();
  world.version++;
}

/** Current rendered state: scrubbed sample or live. */
export function viewState(): { pos: Vec3; vel: Vec3; t: number } {
  if (world.scrub != null && world.history[world.scrub]) {
    const s = world.history[world.scrub];
    return { pos: s.pos, vel: s.vel, t: s.t };
  }
  return { pos: world.pos, vel: world.vel, t: world.t };
}

/* ---------- telemetry snapshot for UI polling ---------- */
export interface Telemetry {
  t: number;
  alt: number;
  dist: number;
  speed: number;
  accel: number;
  force: number;
  K: number; U: number; E: number;
  status: string;
  elems: OrbitalElements | null;
  launched: boolean;
  alive: boolean;
  scrub: number | null;
  histLen: number;
  dV: number;
  maxAlt: number;
  maxV: number;
}
export function telemetry(): Telemetry {
  const st = viewState();
  const r = vLen(st.pos);
  const sp = vLen(st.vel);
  const acc = (G * env.M) / (r * r);
  const el = world.scrub != null ? elements(st.pos, st.vel, env.M, env.R) : world.elems;
  return {
    t: st.t, alt: r - env.R, dist: r, speed: sp, accel: acc,
    force: acc * env.craftMass,
    K: kinetic(env.craftMass, sp),
    U: potentialAt(env.M, env.craftMass, r),
    E: kinetic(env.craftMass, sp) + potentialAt(env.M, env.craftMass, r),
    status: world.alive ? (el?.classification ?? world.status) : "IMPACT",
    elems: el, launched: world.launched, alive: world.alive,
    scrub: world.scrub, histLen: world.history.length,
    dV: world.dVUsed, maxAlt: world.maxAlt, maxV: world.maxV,
  };
}
