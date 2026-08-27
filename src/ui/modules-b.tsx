import { useState } from "react";
import { useStore, type WhatIfSnapshot } from "../state/store";
import {
  G, EARTH, MOON_DEF, BODIES, type BodyId,
  gravAccel, escapeV, circV, surfaceGModel, tidalAccel, fmt, fmtKm, fmtTime,
} from "../physics/core";
import { Section, Slider, Toggle, Kv, WeightFigure, JumpFigure, sfx } from "./widgets";

/* ================= WEIGHT LAB + JUMP ================= */
export function WeightModule() {
  const st = useStore();
  const [body, setBody] = useState<BodyId>("earth");
  const m = st.massKg;
  const v0 = st.jumpV;
  const gBody = (id: BodyId) => gravAccel(BODIES[id].M, BODIES[id].R);
  const gSel = gBody(body);

  return (
    <div>
      <Section title="Weight Lab · W = mg">
        <Slider label="Mass (constant everywhere)" value={m} min={10} max={200} step={1} unit="kg" onChange={(v) => st.setWeight({ massKg: v })} />
        <div className="readout text-[9px] text-ink3 mb-2">MASS is invariant — WEIGHT depends on local g.</div>
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(BODIES) as BodyId[]).map((id) => (
            <WeightFigure key={id} name={BODIES[id].name} weight={m * gBody(id)} refWeight={m * 9.81} color={body === id ? "#ffb648" : "#5fe0ff"} />
          ))}
        </div>
        <div className="seg mt-2">
          {(Object.keys(BODIES) as BodyId[]).map((id) => (
            <button key={id} className={body === id ? "on" : ""} onClick={() => { setBody(id); sfx.click(); }}>{BODIES[id].name.slice(0, 3)}</button>
          ))}
        </div>
        <div className="mt-2">
          <Kv k={`Weight on ${BODIES[body].name}`} v={fmt(m * gSel, 1)} unit="N" amber />
          <Kv k="Equivalent kg-force" v={fmt((m * gSel) / 9.80665, 1)} unit="kgf" />
        </div>
      </Section>

      <Section title="Jump Simulator · constant-g projectile">
        <Slider label="Jump velocity v₀" value={v0} min={1} max={8} step={0.1} unit="m/s" amber onChange={(v) => st.setWeight({ jumpV: v })} />
        <JumpFigure v0={v0} g={gSel} color={BODIES[body].tint} />
        <div className="mt-2">
          <Kv k="Max height h = v₀²/2g" v={fmt((v0 * v0) / (2 * gSel), 2)} unit="m" />
          <Kv k="Flight time t = 2v₀/g" v={fmtTime((2 * v0) / gSel)} />
          <Kv k="Local g" v={fmt(gSel, 3)} unit="m/s²" />
        </div>
        <p className="readout text-[8.5px] text-ink3 mt-1">Constant-g approximation, valid because jump height ≪ planetary radius. No air resistance.</p>
      </Section>

      <Section title="Body Comparison & Builder">
        <div className="grid grid-cols-5 gap-1 readout text-[8.5px] text-ink3 mb-1">
          <span>BODY</span><span>MASS</span><span>RADIUS</span><span>g</span><span>vₑ</span>
        </div>
        {(Object.keys(BODIES) as BodyId[]).map((id) => {
          const b = BODIES[id];
          return (
            <button key={id} onClick={() => { st.setPlanet({ focusBody: id, massMult: 1, radiusMult: 1 }); sfx.confirm(); }}
              className={`w-full grid grid-cols-5 gap-1 readout text-[9px] py-1 border-b border-line/40 text-left hover:bg-cyan/5 ${st.focusBody === id ? "text-amber2" : "text-cyan2"}`}>
              <span>{b.name.slice(0, 4)}</span>
              <span>{fmt(b.M, 2)}</span>
              <span>{fmtKm(b.R)}</span>
              <span>{gravAccel(b.M, b.R).toFixed(2)}</span>
              <span>{(escapeV(b.M, b.R) / 1000).toFixed(1)}</span>
            </button>
          );
        })}
        <p className="readout text-[8.5px] text-ink3 mt-1 mb-2">Click a row to make it the central body (ideal spherical g, rotation as catalogued).</p>
        <div className="border border-line2 p-2 bg-hull/60">
          <div className="lbl mb-1.5 !text-amber2">Custom body builder</div>
          <Slider label="Mass" value={st.customBody.M / 1e24} min={0.01} max={100} step={0.01} unit="×10²⁴kg" amber onChange={(v) => st.setPlanet({ customBody: { ...st.customBody, M: v * 1e24 } })} />
          <Slider label="Radius" value={st.customBody.R} min={500} max={80000} step={50} unit="km" amber onChange={(v) => st.setPlanet({ customBody: { ...st.customBody, R: v } })} />
          <Slider label="Rotation period" value={st.customBody.rotH} min={2} max={1000} step={1} unit="h" amber onChange={(v) => st.setPlanet({ customBody: { ...st.customBody, rotH: v } })} />
          <Kv k="Derived g" v={fmt(gravAccel(st.customBody.M, st.customBody.R * 1000), 3)} unit="m/s²" />
          <Kv k="Derived vₑ" v={fmt(escapeV(st.customBody.M, st.customBody.R * 1000) / 1000, 2)} unit="km/s" />
          <Kv k="Surface orbit v" v={fmt(circV(st.customBody.M, st.customBody.R * 1000) / 1000, 2)} unit="km/s" />
          <button className="btn amber w-full mt-2" onClick={() => { st.setPlanet({ focusBody: "custom" }); sfx.confirm(); }}>LOAD AS CENTRAL BODY</button>
        </div>
      </Section>
    </div>
  );
}

/* ================= MOON + TIDES ================= */
export function MoonModule() {
  const st = useStore();
  const M = EARTH.M * st.massMult;
  const R = EARTH.R * st.radiusMult;
  const mM = MOON_DEF.M * st.moonMassMult;
  const d = MOON_DEF.dist * st.moonDistMult;
  const F = (G * M * mM) / (d * d);
  const vOrb = Math.sqrt((G * (M + mM)) / d);
  const T = (2 * Math.PI * d) / vOrb;
  const tide = st.hasMoon ? tidalAccel(mM, d, R) : 0;
  const tideRef = tidalAccel(MOON_DEF.M, MOON_DEF.dist, EARTH.R);

  return (
    <div>
      <Section title="Moon System">
        <Toggle label="Moon present" on={st.hasMoon} onChange={(b) => st.setPlanet({ hasMoon: b })} />
        <Slider label="Moon mass" value={st.moonMassMult} min={0.1} max={3} step={0.05} unit="×" onChange={(v) => st.setPlanet({ moonMassMult: v })} />
        <Slider label="Moon distance" value={st.moonDistMult} min={0.5} max={1.5} step={0.01} unit="×" onChange={(v) => st.setPlanet({ moonDistMult: v })} />
        <Slider label="Orbital speed factor" value={st.moonSpeedMult} min={0.5} max={2} step={0.05} unit="×" amber onChange={(v) => st.setPlanet({ moonSpeedMult: v })} />
        <div className="flex gap-1.5 mt-1">
          <button className="btn flex-1 !text-[8px]" onClick={() => { st.setPlanet({ hasMoon: false }); sfx.warn(); }}>NO MOON</button>
          <button className="btn flex-1 !text-[8px]" onClick={() => { st.setPlanet({ hasMoon: true, moonMassMult: 2 }); sfx.confirm(); }}>MOON ×2</button>
          <button className="btn flex-1 !text-[8px]" onClick={() => { st.setPlanet({ hasMoon: true, moonMassMult: 1, moonDistMult: 1, moonSpeedMult: 1 }); sfx.click(); }}>RESTORE</button>
        </div>
      </Section>

      <Section title="Earth–Moon Interaction">
        <Kv k="Mutual force GMm/d²" v={fmt(F, 3)} unit="N" />
        <Kv k="Moon orbital speed" v={fmt(vOrb / 1000, 3)} unit="km/s" />
        <Kv k="Orbital period" v={st.hasMoon ? fmtTime(T) : "—"} />
        <Kv k="Moon gravity at Earth" v={st.hasMoon ? fmt((G * mM) / (d * d) * 1e6, 2) : "0"} unit="µm/s²" />
      </Section>

      <Section title="Tidal Field">
        <Kv k="Differential accel 2GMmR/d³" v={fmt(tide * 1e6, 3)} unit="µm/s²" amber />
        <Kv k="Vs real Earth–Moon" v={tideRef > 0 ? `${(tide / tideRef).toFixed(2)}×` : "—"} />
        <div className="mt-1">
          <div className="flex justify-between"><span className="lbl">Tidal strength</span></div>
          <div className="h-2 bg-hull border border-line mt-1 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyandim to-cyan transition-all duration-500" style={{ width: `${Math.min(100, (tide / (tideRef * 6)) * 100)}%` }} />
          </div>
        </div>
        <p className="readout text-[8.5px] text-ink3 mt-2 leading-relaxed">
          Tides arise from the DIFFERENCE in lunar pull across Earth — the near side is pulled harder than the far side, stretching the oceans into two bulges. The blue shell is exaggerated ~40 000× to be visible; values above are real model output.
        </p>
        <div className="mt-1 border border-line2 p-2 bg-hull/60">
          <div className="lbl mb-1">NO-MOON comparison (model-supported)</div>
          <Kv k="Tidal differential" v={st.hasMoon ? `${fmt(tide * 1e6, 3)} µm/s²` : "0 µm/s²"} amber={!st.hasMoon} />
          <Kv k="Mutual force" v={st.hasMoon ? `${fmt(F, 2)} N` : "0 N"} />
          <div className="readout text-[8.5px] text-ink3 mt-1">Only quantities this model computes are compared — no climate or biological claims.</div>
        </div>
      </Section>
    </div>
  );
}

/* ================= WHAT-IF EARTH ENGINE ================= */
interface Preset { label: string; patch: Partial<WhatIfSnapshot>; }
const PRESETS: Preset[] = [
  { label: "2× MASS", patch: { massMult: 2 } },
  { label: "0.5× MASS", patch: { massMult: 0.5 } },
  { label: "2× RADIUS", patch: { radiusMult: 2 } },
  { label: "0.5× RADIUS", patch: { radiusMult: 0.5 } },
  { label: "2× ROTATION", patch: { rotMult: 2 } },
  { label: "HALF ROTATION", patch: { rotMult: 0.5 } },
  { label: "NO MOON", patch: { hasMoon: false } },
  { label: "2× MOON MASS", patch: { hasMoon: true, moonMassMult: 2 } },
  { label: "CLOSER MOON", patch: { hasMoon: true, moonDistMult: 0.7 } },
  { label: "MARS-SIZED EARTH", patch: { massMult: 0.107, radiusMult: 0.532 } },
];

function snapNow(): WhatIfSnapshot {
  const s = useStore.getState();
  return { label: "CURRENT", massMult: s.massMult, radiusMult: s.radiusMult, rotMult: s.rotMult, hasMoon: s.hasMoon, moonMassMult: s.moonMassMult, moonDistMult: s.moonDistMult };
}
function derive(s: WhatIfSnapshot) {
  const M = EARTH.M * s.massMult, R = EARTH.R * s.radiusMult, T = 86164.0905 / s.rotMult;
  const g = surfaceGModel(M, R, T, 0, "rotating");
  return {
    M, R, T, g,
    ve: escapeV(M, R),
    vorb: circV(M, R),
    weight: 70 * g,
    tide: s.hasMoon ? tidalAccel(MOON_DEF.M * s.moonMassMult, MOON_DEF.dist * s.moonDistMult, R) : 0,
  };
}

export function WhatIfModule() {
  const st = useStore();
  const [pending, setPending] = useState<{ preset: Preset; actual: number } | null>(null);
  const [guess, setGuess] = useState("");

  const applyPreset = (p: Preset) => {
    const base = { ...snapNow(), label: "REAL EARTH" };
    const altered: WhatIfSnapshot = { ...base, ...p.patch, label: p.label };
    const actual = derive(altered).g;
    if (st.discovery) {
      setPending({ preset: p, actual });
      setGuess("");
      sfx.tick();
      return;
    }
    commit(base, altered);
  };

  const commit = (base: WhatIfSnapshot, altered: WhatIfSnapshot) => {
    st.setPlanet({
      massMult: altered.massMult, radiusMult: altered.radiusMult, rotMult: altered.rotMult,
      hasMoon: altered.hasMoon, moonMassMult: altered.moonMassMult, moonDistMult: altered.moonDistMult,
    });
    st.setWhatIf({ baseline: base, altered });
    sfx.confirm();
    st.setCamera("PLANET");
    const db = derive(base), da = derive(altered);
    st.addEntry({
      title: `WHAT-IF · ${altered.label}`,
      objective: `Alter Earth: ${altered.label} and measure the physical response`,
      given: `M ${fmt(db.M)} → ${fmt(da.M)} kg · R ${fmt(db.R)} → ${fmt(da.R)} m · T ${fmt(db.T)} → ${fmt(da.T)} s`,
      formula: "g = GM/R² · vₑ = √(2GM/R) · v_orb = √(GM/R)",
      calc: `g ${db.g.toFixed(3)} → ${da.g.toFixed(3)} m/s² · vₑ ${fmt(db.ve / 1000, 2)} → ${fmt(da.ve / 1000, 2)} km/s`,
      observation: `Surface gravity changed by ${(((da.g - db.g) / db.g) * 100).toFixed(1)}%`,
      conclusion: da.g > db.g ? "More mass (or smaller radius) deepens the gravity well: everything weighs more and escape demands more speed." : "Reducing mass or inflating radius weakens the field; escape becomes cheaper.",
      note: "",
    });
  };

  const b = st.whatIf.baseline ? derive(st.whatIf.baseline) : null;
  const a = st.whatIf.altered ? derive(st.whatIf.altered) : null;
  const rows: { k: string; get: (d: NonNullable<typeof b>) => number; unit: string; f: (n: number) => string }[] = [
    { k: "Mass", get: (d) => d.M, unit: "kg", f: (n) => fmt(n) },
    { k: "Radius", get: (d) => d.R, unit: "m", f: (n) => fmtKm(n) },
    { k: "Surface g", get: (d) => d.g, unit: "m/s²", f: (n) => n.toFixed(3) },
    { k: "Escape v", get: (d) => d.ve / 1000, unit: "km/s", f: (n) => n.toFixed(2) },
    { k: "Surface orbit v", get: (d) => d.vorb / 1000, unit: "km/s", f: (n) => n.toFixed(2) },
    { k: "Rotation period", get: (d) => d.T / 3600, unit: "h", f: (n) => n.toFixed(1) },
    { k: "70 kg weight", get: (d) => d.weight, unit: "N", f: (n) => fmt(n, 0) },
    { k: "Tidal accel", get: (d) => d.tide * 1e6, unit: "µm/s²", f: (n) => n.toFixed(3) },
  ];

  return (
    <div>
      <Section title="WHAT IF EARTH…?" right={
        <button className={`btn !px-2 !py-1 !text-[8px] ${st.discovery ? "amber" : ""}`} onClick={() => { st.setDiscovery(!st.discovery); sfx.click(); }}>
          {st.discovery ? "DISCOVERY ON" : "DISCOVERY"}
        </button>
      }>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} className="btn !text-[8.5px]" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          <button className="btn flex-1" onClick={() => {
            const base = { label: "REAL EARTH", massMult: 1, radiusMult: 1, rotMult: 1, hasMoon: true, moonMassMult: 1, moonDistMult: 1 };
            st.setPlanet({ massMult: 1, radiusMult: 1, rotMult: 1, hasMoon: true, moonMassMult: 1, moonDistMult: 1 });
            st.setWhatIf({ baseline: null, altered: null }); sfx.click();
          }}>RESTORE EARTH</button>
          <button className="btn amber flex-1" onClick={() => { st.setFinalMoment(true); sfx.confirm(); }}>FINAL MOMENT</button>
        </div>
        {st.discovery && (
          <p className="readout text-[8.5px] text-amber2/80 mt-2">DISCOVERY MODE: you predict the new surface g before the engine simulates. Science first, answer second.</p>
        )}
      </Section>

      {pending && (
        <div className="border border-amber/60 bg-amber/5 p-3 mb-4 rise-in">
          <div className="lbl !text-amber2 mb-1">PREDICT → SIMULATE → VERIFY</div>
          <div className="readout text-[10.5px] text-ink mb-2">If Earth becomes <span className="text-amber2">{pending.preset.label}</span>, what is the new surface g?</div>
          <div className="flex gap-1.5">
            <input className="nin flex-1" type="number" placeholder="your prediction, m/s²" value={guess} onChange={(e) => setGuess(e.target.value)} />
            <button className="btn primary" onClick={() => {
              const g0 = parseFloat(guess);
              const base = { ...snapNow(), label: "REAL EARTH" };
              const altered: WhatIfSnapshot = { ...base, ...pending.preset.patch, label: pending.preset.label };
              commit(base, altered);
              const actual = derive(altered).g;
              if (isFinite(g0)) {
                const err = (Math.abs(g0 - actual) / actual) * 100;
                setTimeout(() => sfx[err < 5 ? "confirm" : "warn"](), 300);
                window.setTimeout(() => {
                  const s = useStore.getState();
                  s.addEntry({
                    title: `PREDICTION CHECK · ${altered.label}`,
                    objective: "Predict surface gravity before simulating",
                    given: `Prediction ${g0} m/s²`,
                    formula: "g = GM/R²",
                    calc: `Actual ${actual.toFixed(4)} m/s²`,
                    observation: `Error ${err.toFixed(1)}%`,
                    conclusion: err < 5 ? "Prediction confirmed — the inverse-square law works." : "The model disagrees — inspect which variable dominates.",
                    note: "",
                  });
                }, 50);
              }
              setPending(null);
            }}>SIMULATE</button>
          </div>
        </div>
      )}

      {b && a && st.whatIf.baseline && st.whatIf.altered && (
        <Section title="Before vs After">
          <div className="flex justify-between readout text-[9px] mb-1">
            <span className="text-cyan2">{st.whatIf.baseline.label}</span>
            <span className="text-amber2">{st.whatIf.altered.label}</span>
          </div>
          {rows.map((r) => {
            const bv = r.get(b), av = r.get(a);
            const delta = bv !== 0 ? ((av - bv) / Math.abs(bv)) * 100 : 0;
            const scale = Math.max(bv, av) || 1;
            return (
              <div key={r.k} className="mb-1.5">
                <div className="flex justify-between items-baseline">
                  <span className="lbl">{r.k}</span>
                  <span className="readout text-[9.5px] text-ink2">
                    <span className="text-cyan2">{r.f(bv)}</span> → <span className="text-amber2">{r.f(av)}</span>
                    <span className={`ml-1 ${delta > 0.5 ? "text-ok" : delta < -0.5 ? "text-danger" : "text-ink3"}`}>{delta > 0.5 ? "+" : ""}{delta.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="flex gap-0.5 mt-0.5">
                  <div className="h-1 bg-cyan/70 transition-all duration-700" style={{ width: `${(bv / scale) * 100}%` }} />
                </div>
                <div className="flex gap-0.5 mt-0.5">
                  <div className="h-1 bg-amber/80 transition-all duration-700" style={{ width: `${(av / scale) * 100}%` }} />
                </div>
              </div>
            );
          })}
          <p className="readout text-[8.5px] text-ink3 mt-1">Derived live from g=GM/R², vₑ=√(2GM/R), tidal 2GMmR/d³ — same models driving the 3D scene.</p>
        </Section>
      )}

      <Section title="Planet Designer — custom Earth">
        <Slider label="Mass" value={st.massMult} min={0.1} max={5} step={0.05} unit="×" id="mass" onChange={(v) => st.setPlanet({ massMult: v })} />
        <Slider label="Radius" value={st.radiusMult} min={0.5} max={2} step={0.02} unit="×" id="radius" onChange={(v) => st.setPlanet({ radiusMult: v })} />
        <Slider label="Rotation" value={st.rotMult} min={0.1} max={5} step={0.05} unit="×" id="rotation" onChange={(v) => st.setPlanet({ rotMult: v })} />
        <Slider label="Moon mass" value={st.moonMassMult} min={0.1} max={3} step={0.05} unit="×" onChange={(v) => st.setPlanet({ moonMassMult: v })} />
        <Slider label="Moon distance" value={st.moonDistMult} min={0.5} max={1.5} step={0.01} unit="×" onChange={(v) => st.setPlanet({ moonDistMult: v })} />
        <button className="btn primary w-full mt-1" onClick={() => {
          st.setWhatIf({ baseline: { label: "REAL EARTH", massMult: 1, radiusMult: 1, rotMult: 1, hasMoon: true, moonMassMult: 1, moonDistMult: 1 }, altered: { ...snapNow(), label: "CUSTOM EARTH" } });
          sfx.confirm();
        }}>SIMULATE PLANET</button>
        <PlanetProfile />
      </Section>
    </div>
  );
}

function PlanetProfile() {
  const st = useStore();
  const M = EARTH.M * st.massMult, R = EARTH.R * st.radiusMult, T = 86164.0905 / st.rotMult;
  const g = surfaceGModel(M, R, T, 0, "rotating");
  const cls = g > 15 ? "SUPER-DENSE WORLD" : g > 11 ? "SUPER-EARTH CLASS" : g > 7 ? "TERRAN CLASS" : g > 4 ? "MARTIAN CLASS" : "LOW-G WORLD";
  return (
    <div className="border border-line2 bg-hull/70 p-2.5 mt-2 corners">
      <div className="lbl !text-cyan mb-1">Planetary profile</div>
      <div className="readout text-[12px] text-amber2 tracking-[0.15em] mb-1">{cls}</div>
      <Kv k="Surface g" v={g.toFixed(3)} unit="m/s²" />
      <Kv k="Escape velocity" v={fmt(escapeV(M, R) / 1000, 2)} unit="km/s" />
      <Kv k="LEO-400 velocity" v={fmt(circV(M, R + 4e5) / 1000, 2)} unit="km/s" />
      <Kv k="Day length" v={fmtTime(T)} />
      <Kv k="70 kg weight" v={fmt(70 * g, 0)} unit="N" />
    </div>
  );
}
