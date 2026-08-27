/* ============================================================
   EARTH: GRAVITY ENGINE — physics core
   All values SI unless noted. Newtonian gravity, point-mass
   model unless an educational correction is explicitly labelled.
   ============================================================ */

export const G = 6.674e-11; // N m² kg⁻²

export const EARTH = { M: 5.972e24, R: 6.371e6, rotPeriod: 86164.0905, f: 1 / 298.257 };
export const MOON_DEF = { M: 7.342e22, dist: 3.844e8, R: 1.7374e6 };
export const SUN = { M: 1.989e30, dist: 1.496e11 };
export const AU = 1.496e11;

export type Vec3 = { x: number; y: number; y2?: never; z: number };

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vMul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vLen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const vNorm = (a: Vec3): Vec3 => {
  const l = vLen(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const vCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/* ---------- celestial body catalogue ---------- */
export type BodyId = "earth" | "moon" | "mars" | "jupiter";
export interface BodyDef {
  id: BodyId;
  name: string;
  M: number;
  R: number;
  rotH: number; // sidereal rotation period, hours
  tint: string;
}
export const BODIES: Record<BodyId, BodyDef> = {
  earth: { id: "earth", name: "EARTH", M: 5.972e24, R: 6.371e6, rotH: 23.934, tint: "#4aa3df" },
  moon: { id: "moon", name: "MOON", M: 7.342e22, R: 1.7374e6, rotH: 655.7, tint: "#9aa3ad" },
  mars: { id: "mars", name: "MARS", M: 6.417e23, R: 3.3895e6, rotH: 24.623, tint: "#d1703f" },
  jupiter: { id: "jupiter", name: "JUPITER", M: 1.898e27, R: 6.9911e7, rotH: 9.925, tint: "#d8b48a" },
};

/* ---------- exact two-body equations ---------- */
export const gravAccel = (M: number, r: number): number => (G * M) / (r * r); // g = GM/r²
export const forceOn = (M: number, m: number, r: number): number => (G * M * m) / (r * r);
export const escapeV = (M: number, R: number): number => Math.sqrt((2 * G * M) / R); // ve = √(2GM/R)
export const circV = (M: number, r: number): number => Math.sqrt((G * M) / r); // v = √(GM/r)
export const potentialAt = (M: number, m: number, r: number): number => (-G * M * m) / r; // U = −GMm/r
export const kinetic = (m: number, v: number): number => 0.5 * m * v * v; // K = ½mv²
export const omegaOf = (periodS: number): number => (2 * Math.PI) / periodS; // ω = 2π/T
export const orbitalPeriod = (a: number, M: number): number => 2 * Math.PI * Math.sqrt(a ** 3 / (G * M));

/* ---------- educational rotating-Earth surface gravity ----------
   g_eff(φ) = GM/r(φ)² − ω²·r(φ)·cos²φ   (centrifugal reduction)
   r(φ) = R·(1 − f·sin²φ), flattening scaled with rotation² (labelled approximation). */
export function surfaceGModel(M: number, R: number, rotPeriodS: number, latDeg: number, model: "sphere" | "rotating"): number {
  const g0 = gravAccel(M, R);
  if (model === "sphere") return g0;
  const rotFactor = EARTH.rotPeriod / rotPeriodS;
  const f = Math.min(0.22, EARTH.f * rotFactor * rotFactor * 6); // exaggerated flattening for visibility, capped
  const phi = (latDeg * Math.PI) / 180;
  const r = R * (1 - f * Math.sin(phi) ** 2);
  const om = omegaOf(rotPeriodS);
  return gravAccel(M, r) - om * om * r * Math.cos(phi) ** 2;
}

/* ---------- exponential atmosphere (educational drag model) ---------- */
export const RHO0 = 1.225; // kg/m³ sea level
export const SCALE_H = 8500; // m
export const KARMAN = 100_000; // m
export function airDensity(altM: number): number {
  if (altM < 0) return RHO0;
  if (altM > 120_000) return 0;
  return RHO0 * Math.exp(-altM / SCALE_H);
}
export function dragAccel(rho: number, v: number, Cd: number, A: number, m: number): number {
  return (0.5 * rho * v * v * Cd * A) / m; // a = ½ρv²CdA / m
}

/* ---------- orbital state & classification ---------- */
export interface OrbitalElements {
  r: number; // |r| m
  speed: number; // m/s
  eps: number; // specific energy J/kg
  a: number; // semi-major axis (m); negative ⇒ hyperbolic
  e: number; // eccentricity
  rp: number; // periapsis distance m
  ra: number; // apoapsis m (Infinity if escaping)
  period: number | null; // s, null if escaping
  h: number; // specific angular momentum
  classification: "IMPACT" | "SUBORBITAL" | "CIRCULAR" | "ELLIPTICAL" | "ESCAPE";
}

export function elements(pos: Vec3, vel: Vec3, M: number, bodyR: number): OrbitalElements {
  const r = vLen(pos);
  const speed = vLen(vel);
  const eps = (speed * speed) / 2 - (G * M) / r;
  const hVec = vCross(pos, vel);
  const h = vLen(hVec);
  // eccentricity vector: e = ((v²−GM/r)·r⃗ − (r⃗·v⃗)·v⃗)/GM
  const rv = vDot(pos, vel);
  const ex = (((speed * speed - (G * M) / r) * pos.x - rv * vel.x) / (G * M));
  const ey = (((speed * speed - (G * M) / r) * pos.y - rv * vel.y) / (G * M));
  const ez = (((speed * speed - (G * M) / r) * pos.z - rv * vel.z) / (G * M));
  const e = Math.hypot(ex, ey, ez);
  const rp = h * h / (G * M * (1 + e || 1));
  let classification: OrbitalElements["classification"];
  let a = Infinity;
  let ra = Infinity;
  let period: number | null = null;
  if (eps >= 0) {
    classification = "ESCAPE";
    a = eps > 0 ? -(G * M) / (2 * eps) : Infinity;
  } else {
    a = -(G * M) / (2 * eps);
    ra = a * (1 + e);
    period = orbitalPeriod(a, M);
    if (rp < bodyR) classification = e > 0.9 && ra < bodyR * 3 ? "SUBORBITAL" : "IMPACT";
    else if (rp < bodyR * 1.005 && e < 0.2) classification = "SUBORBITAL";
    else classification = e < 0.025 ? "CIRCULAR" : "ELLIPTICAL";
  }
  return { r, speed, eps, a, e, rp, ra, period, h, classification };
}

/* ---------- Hohmann transfer (idealized two-body, coplanar) ---------- */
export function hohmann(M: number, r1: number, r2: number) {
  const aT = (r1 + r2) / 2;
  const v1 = circV(M, r1);
  const v2 = circV(M, r2);
  const vp = Math.sqrt(G * M * (2 / r1 - 1 / aT));
  const va = Math.sqrt(G * M * (2 / r2 - 1 / aT));
  const tT = Math.PI * Math.sqrt(aT ** 3 / (G * M)); // half period of transfer ellipse
  const T2 = 2 * Math.PI * Math.sqrt(r2 ** 3 / (G * M)); // target circular period
  return {
    dv1: vp - v1,
    dv2: v2 - va,
    dvTotal: Math.abs(vp - v1) + Math.abs(v2 - va),
    transferTime: tT,
    phaseAngle: 180 - (360 * tT) / T2, // launch when target leads by this angle
    aT,
  };
}

/* ---------- tidal differential acceleration across Earth ---------- */
export function tidalAccel(mMoon: number, dist: number, bodyR = EARTH.R): number {
  return (2 * G * mMoon * bodyR) / dist ** 3; // near/far-side differential
}

/* ---------- formatting ---------- */
export function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return "∞";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6 || abs < 0.001) {
    const exp = Math.floor(Math.log10(abs));
    const mant = n / 10 ** exp;
    return `${mant.toFixed(digits)}×10${sup(exp)}`;
  }
  return n.toFixed(digits);
}
export function sup(n: number): string {
  const s = String(n);
  const map: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return s.split("").map((c) => map[c] ?? c).join("");
}
export function fmtKm(m: number): string {
  const km = m / 1000;
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)} Mkm`;
  if (km >= 1000) return `${(km / 1000).toFixed(2)}k km`;
  return `${km.toFixed(0)} km`;
}
export function fmtTime(s: number): string {
  if (!isFinite(s)) return "∞";
  if (s < 120) return `${s.toFixed(0)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(2)} h`;
  return `${(s / 86400).toFixed(1)} d`;
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
