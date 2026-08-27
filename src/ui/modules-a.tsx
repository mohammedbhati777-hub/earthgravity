import { useStore, planetM, planetR } from "../state/store";
import world, { launch, resetCraft, burn, predict } from "../state/world";
import {
  G, gravAccel, escapeV, circV, elements, surfaceGModel, fmt, fmtKm, fmtTime, v3, KARMAN,
} from "../physics/core";
import { Section, Slider, Toggle, Kv, GravityMeter, sfx, useTelemetry } from "./widgets";

/* ---------- classification badge ---------- */
const CLS_COLOR: Record<string, string> = {
  IMPACT: "text-danger border-danger/60 bg-danger/10",
  SUBORBITAL: "text-amber2 border-amber/60 bg-amber/10",
  CIRCULAR: "text-ok border-ok/60 bg-ok/10",
  ELLIPTICAL: "text-cyan2 border-cyan/60 bg-cyan/10",
  ESCAPE: "text-amber2 border-amber2/70 bg-amber/15",
  READY: "text-ink2 border-line2",
  "IN FLIGHT": "text-cyan2 border-cyan/50 bg-cyan/5",
};
export function ClsBadge({ cls }: { cls: string }) {
  return (
    <span className={`readout text-[11px] tracking-[0.18em] border px-2 py-0.5 ${CLS_COLOR[cls] ?? "text-ink2 border-line2"}`}>
      {cls}
    </span>
  );
}

export function launchFromStore() {
  const st = useStore.getState();
  launch({
    altM: st.altKm * 1000,
    speed: st.speedKms * 1000,
    angleDeg: st.angleDeg,
    lat: st.site?.lat ?? 0,
    lon: st.site?.lon ?? 0,
  });
  sfx.launch();
  st.setCamera("ORBIT");
  st.setRunning(true);
  const M = planetM(st), R = planetR(st);
  const el = elements(world.pos, world.vel, M, R);
  st.addEntry({
    title: "ORBITAL LAUNCH",
    objective: `Insert ${st.craftMass} kg craft from ${st.altKm} km at ${st.speedKms} km/s (elev ${st.angleDeg}°)`,
    given: `M = ${fmt(M)} kg · R = ${fmt(R)} m · launch site ${st.site?.lat ?? 0}°, ${st.site?.lon ?? 0}°`,
    formula: "ε = v²/2 − GM/r · e from eccentricity vector · v_c = √(GM/r)",
    calc: `ε = ${fmt(el.eps, 3)} J/kg · e = ${el.e.toFixed(4)} · v_c(${fmtKm(R + st.altKm * 1000)}) = ${fmt(circV(M, R + st.altKm * 1000) / 1000, 3)} km/s`,
    observation: `Trajectory classified ${el.classification} by the integrator (velocity-Verlet, dt 3 s)`,
    conclusion:
      el.classification === "CIRCULAR" || el.classification === "ELLIPTICAL"
        ? "Specific energy is negative and periapsis clears the surface: the craft is gravitationally bound."
        : el.classification === "ESCAPE"
          ? "Specific energy ≥ 0: the craft exceeds local escape speed and leaves on an open trajectory."
          : "Periapsis lies inside the planet: without a burn the trajectory intersects the surface.",
    note: "",
  });
}

/* ================= ORBIT SANDBOX ================= */
export function OrbitModule() {
  const st = useStore();
  const t = useTelemetry(180);
  const M = planetM(st), R = planetR(st);
  const rotP = 86164.0905 / st.rotMult;

  const planned = (() => {
    const r = R + st.altKm * 1000;
    const vRot = ((2 * Math.PI) / rotP) * r * Math.cos(((st.site?.lat ?? 0) * Math.PI) / 180);
    const a = (st.angleDeg * Math.PI) / 180;
    const vh = st.speedKms * 1000 * Math.cos(a) + vRot;
    const vv = st.speedKms * 1000 * Math.sin(a);
    return elements(v3(r, 0, 0), v3(0, vv, vh), M, R);
  })();

  const vReq = t.launched ? circV(M, t.dist) : circV(M, R + st.altKm * 1000);
  const vCur = t.launched ? t.speed : planned.speed;
  const ratio = Math.min(2, vCur / vReq);

  return (
    <div>
      <Section title="Launch Parameters">
        <Slider label="Altitude" value={st.altKm} min={0} max={12000} step={10} unit="km" id="alt" onChange={(v) => st.setOrbit({ altKm: v })} />
        <Slider label="Velocity" value={st.speedKms} min={0} max={16} step={0.01} unit="km/s" id="velocity" amber onChange={(v) => { st.setOrbit({ speedKms: v }); }} />
        <Slider label="Elevation angle" value={st.angleDeg} min={0} max={90} step={1} unit="°" onChange={(v) => st.setOrbit({ angleDeg: v })} />
        <Slider label="Craft mass" value={st.craftMass} min={50} max={5000} step={50} unit="kg" onChange={(v) => st.setOrbit({ craftMass: v })} />
        <div className="readout text-[9.5px] text-ink3 mb-2">
          SITE {st.site ? `${st.site.lat}°, ${st.site.lon}°` : "—"} · <span className="text-cyan2/70">click the planet to relocate</span> · eastward rotational boost {( (((2 * Math.PI) / rotP) * (R + st.altKm * 1000) * Math.cos(((st.site?.lat ?? 0) * Math.PI) / 180)) / 1000).toFixed(3)} km/s included
        </div>
        <div className="flex gap-2">
          <button className="btn primary flex-1" onClick={launchFromStore}>▲ LAUNCH</button>
          <button className="btn" onClick={() => { resetCraft(); sfx.click(); }}>RESET</button>
          <button className="btn" onClick={() => { predict(); sfx.tick(); }}>RE-PREDICT</button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="lbl">Predicted (pre-launch)</span>
          <ClsBadge cls={t.launched ? t.status : planned.classification} />
        </div>
      </Section>

      <Section title="Orbital Mechanics — live">
        <Kv k="Speed" v={fmt(t.launched ? t.speed / 1000 : 0, 3)} unit="km/s" />
        <Kv k="Required circular v" v={fmt(vReq / 1000, 3)} unit="km/s" />
        <Kv k="Altitude" v={t.launched ? fmtKm(t.alt) : "—"} />
        <Kv k="Eccentricity e" v={t.elems ? t.elems.e.toFixed(4) : "—"} />
        <Kv k="Periapsis" v={t.elems && t.elems.rp < 1e9 ? fmtKm(t.elems.rp - R) : "—"} />
        <Kv k="Apoapsis" v={t.elems && isFinite(t.elems.ra) && t.elems.ra < 1e10 ? fmtKm(t.elems.ra - R) : "∞"} />
        <Kv k="Period" v={t.elems?.period ? fmtTime(t.elems.period) : "—"} />
        <Kv k="Specific energy ε" v={t.elems ? fmt(t.elems.eps, 3) : "—"} unit="J/kg" />
        <div className="mt-2">
          <div className="flex justify-between"><span className="lbl">Current vs circular speed</span><span className="readout text-[10px] text-amber2">{(ratio * 100).toFixed(0)}%</span></div>
          <div className="h-2 bg-hull border border-line mt-1 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyandim to-cyan transition-all" style={{ width: `${(ratio / 2) * 100}%` }} />
            <div className="absolute inset-y-0 w-px bg-amber" style={{ left: "50%" }} />
          </div>
          <div className="readout text-[8px] text-ink3 mt-0.5">marker = circular speed · full scale = 2×</div>
        </div>
      </Section>

      <Section title="Maneuvers & Forces">
        <div className="flex gap-2 mb-2">
          <button className="btn flex-1" disabled={!t.launched || !t.alive} onClick={() => { burn(100); sfx.confirm(); }}>PROGRADE +100 m/s</button>
          <button className="btn flex-1" disabled={!t.launched || !t.alive} onClick={() => { burn(-100); sfx.warn(); }}>RETRO −100 m/s</button>
        </div>
        <Kv k="Δv used" v={fmt(t.dV, 0)} unit="m/s" amber />
        <div className="mt-2">
          <Toggle label="Moon gravity on craft" on={st.moonGrav} onChange={(b) => st.setOrbit({ moonGrav: b })} />
          <Toggle label="Sun gravity on craft" on={st.sunGrav} onChange={(b) => st.setOrbit({ sunGrav: b })} />
          <Toggle label="Atmospheric drag (exp model)" on={st.dragModel} onChange={(b) => st.setDragModel(b)} amber />
        </div>
        <Slider label="Trail length" value={st.trailLen} min={100} max={3000} step={50} unit="pts" onChange={(v) => st.setOrbit({ trailLen: v })} />
      </Section>
      <p className="readout text-[8.5px] text-ink3 leading-relaxed">
        MODEL: two-body Newtonian, point-mass planet, velocity-Verlet dt=3 s. Drag uses ρ=ρ₀e^(−h/8.5km), Cd 0.5, A 10 m². No lift, no third-body terms unless enabled.
      </p>
    </div>
  );
}

/* ================= GRAVITY FIELD MODULE ================= */
export function FieldModule() {
  const st = useStore();
  const M = planetM(st), R = planetR(st);
  const rotP = 86164.0905 / st.rotMult;
  const alt = st.altKm;
  const r = R + alt * 1000;
  const g = gravAccel(M, r);
  const gSurf = surfaceGModel(M, R, rotP, st.site?.lat ?? 0, "rotating");

  return (
    <div>
      <Section title="Gravity Explorer · g = GM/r²">
        <GravityMeter g={gSurf} label={`SURFACE g · ${st.site ? st.site.lat + "°" : "0°"}`} />
        <Slider label="Probe altitude" value={alt} min={0} max={10000} step={10} unit="km" id="alt" onChange={(v) => st.setOrbit({ altKm: v })} />
        <div className="flex gap-1.5 mb-2">
          {[0, 100, 400, 1000].map((k) => (
            <button key={k} className={`btn flex-1 !px-1 ${alt === k ? "on" : ""}`} onClick={() => { st.setOrbit({ altKm: k }); sfx.tick(); }}>{k}</button>
          ))}
        </div>
        <Kv k="Distance r" v={fmtKm(r)} />
        <Kv k="g at altitude" v={fmt(g, 4)} unit="m/s²" />
        <Kv k="g / surface g" v={`${((g / gSurf) * 100).toFixed(1)}%`} />
        <Kv k="Escape v at r" v={fmt(escapeV(M, r) / 1000, 3)} unit="km/s" />
        <Kv k="Circular v at r" v={fmt(circV(M, r) / 1000, 3)} unit="km/s" />
        <div className="lbl mt-2 mb-1">Latitude gravity sweep · equator ↔ pole</div>
        <Slider label="Site latitude" value={st.site?.lat ?? 0} min={-90} max={90} step={1} unit="°" amber onChange={(v) => st.setSite({ lat: v, lon: st.site?.lon ?? 0 })} />
        <Kv k="Rotation period T" v={fmtTime(rotP)} />
        <Kv k="ω = 2π/T" v={(2 * Math.PI / rotP).toExponential(3)} unit="rad/s" />
        <Kv k="Equatorial speed ωR" v={fmt(((2 * Math.PI) / rotP) * R / 1000, 3)} unit="km/s" />
        <button className="btn w-full mt-2" onClick={() => {
          const dir = st.probe; const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
          const nr = (R + alt * 1000) / 6.371e6;
          st.setProbe({ x: (dir.x / l) * nr, y: (dir.y / l) * nr, z: (dir.z / l) * nr });
          st.setMode("PROBE"); sfx.confirm();
        }}>SEND GRAVITY PROBE TO THIS ALTITUDE</button>
      </Section>

      <Section title="Field Visualization">
        <div className="seg mb-2">
          {(["LINES", "VECTORS", "HEAT", "NUMERIC"] as const).map((m) => (
            <button key={m} className={st.fieldVis === m ? "on" : ""} onClick={() => { st.setField({ fieldVis: m }); sfx.click(); }}>{m}</button>
          ))}
        </div>
        <Slider label="Field density" value={st.fieldDensity} min={1} max={5} step={1} onChange={(v) => st.setField({ fieldDensity: v })} />
        <div className="lbl mb-1">Slice plane</div>
        <div className="seg mb-2">
          {(["OFF", "XY", "XZ", "YZ"] as const).map((p) => (
            <button key={p} className={st.fieldPlane === p ? "on" : ""} onClick={() => { st.setField({ fieldPlane: p }); sfx.tick(); }}>{p}</button>
          ))}
        </div>
        <div className="lbl mb-1">Surface gravity map</div>
        <div className="seg">
          {(["OFF", "SPHERE", "ROTATING"] as const).map((p) => (
            <button key={p} className={st.surfaceHeat === p ? "on" : ""} onClick={() => { st.setField({ surfaceHeat: p }); sfx.tick(); }}>{p}</button>
          ))}
        </div>
        <p className="readout text-[8.5px] text-ink3 mt-2 leading-relaxed">
          SPHERE: ideal g=GM/R² (uniform). ROTATING: educational model g(φ)=GM/r(φ)²−ω²r(φ)cos²φ with exaggerated flattening — shows pole/equator difference. Point-mass field lines are radial by symmetry.
        </p>
      </Section>

      <Section title="Atmosphere">
        <Toggle label="Show atmosphere + Kármán line" on={st.atmosphere} onChange={(b) => st.setAtmosphere(b)} />
        <Kv k="Kármán line" v="100 km" />
        <Kv k="Probe vs Kármán" v={alt < 100 ? "INSIDE ATMOSPHERE" : "ABOVE"} amber={alt < 100} />
        <p className="readout text-[8.5px] text-ink3 mt-1 leading-relaxed">
          Boundary shown for scale only. Escape velocity is the ideal, atmosphere-free value; real launches need extra Δv for drag and gravity losses.
        </p>
      </Section>
    </div>
  );
}

/* ================= PROBE MODULE ================= */
export function ProbeModule() {
  const st = useStore();
  const M = planetM(st), R = planetR(st);
  const r = Math.hypot(st.probe.x, st.probe.y, st.probe.z) * 6.371e6;
  const altKm = (r - R) / 1000;
  const g = gravAccel(M, r);
  const U1 = (-G * M) / r;

  const setRadial = (km: number) => {
    const l = Math.hypot(st.probe.x, st.probe.y, st.probe.z) || 1;
    const nr = (R + km * 1000) / 6.371e6;
    st.setProbe({ x: (st.probe.x / l) * nr, y: (st.probe.y / l) * nr, z: (st.probe.z / l) * nr });
  };

  return (
    <div>
      <Section title="Gravity Probe — drag it through space">
        <Kv k="Distance from center" v={fmtKm(r)} />
        <Kv k="Altitude" v={fmtKm(Math.max(0, r - R))} />
        <Kv k="Local g" v={fmt(g, 4)} unit="m/s²" />
        <Kv k="Force on 1 kg" v={fmt(g, 4)} unit="N" />
        <Kv k="Potential / kg · U=−GM/r" v={fmt(U1 / 1e6, 2)} unit="MJ/kg" />
        <Kv k="Escape velocity" v={fmt(escapeV(M, r) / 1000, 3)} unit="km/s" />
        <Kv k="g vs surface" v={`${((g / gravAccel(M, R)) * 100).toFixed(2)}%`} />
      </Section>
      <Section title="Radial Position">
        <Slider label="Altitude" value={Math.max(0, Math.min(200000, altKm))} min={0} max={200000} step={50} unit="km" onChange={(v) => setRadial(v)} amber />
        <div className="grid grid-cols-2 gap-1.5">
          {[["SURFACE", 0], ["KÁRMÁN", 100], ["LEO 400", 400], ["GEO", 35786], ["MOON DIST", 384400]].map(([lb, km]) => (
            <button key={lb as string} className="btn !text-[8px]" onClick={() => { setRadial(km as number); sfx.tick(); }}>{lb}</button>
          ))}
        </div>
        <p className="readout text-[8.5px] text-ink3 mt-2">
          Drag the amber probe in 3D, or slide. All values from g=GM/r², U=−GM/r, vₑ=√(2GM/r) with current planet mass {fmt(M)} kg.
        </p>
      </Section>
    </div>
  );
}
