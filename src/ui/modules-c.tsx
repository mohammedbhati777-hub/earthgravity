import { useEffect, useMemo, useState } from "react";
import { useStore, planetM, planetR, type MissionReport } from "../state/store";
import world, { launch, resetCraft, moonPos, viewState, telemetry } from "../state/world";
import {
  G, SUN, AU, BODIES, gravAccel, escapeV, circV, hohmann, fmt, fmtKm, fmtTime, clamp,
} from "../physics/core";
import { Section, Slider, Kv, SimGraph, sfx, useTelemetry } from "./widgets";
import { ClsBadge } from "./modules-a";

/* ================= MISSIONS + CHALLENGES ================= */
const MISSIONS = [
  { id: 1, name: "MISSION 01", obj: "Reach a stable 400 km circular orbit (e < 0.03, 350–500 km band)." },
  { id: 2, name: "MISSION 02", obj: "Escape Earth: specific energy ε ≥ 0 beyond 3 planetary radii." },
  { id: 3, name: "MISSION 03", obj: "Reach the Moon: pass within 20 000 km of the lunar center." },
  { id: 4, name: "MISSION 04", obj: "Conservation check: total energy drift < 1% over 60 s of orbit." },
];

export function MissionsModule() {
  const st = useStore();
  const t = useTelemetry(300);
  const [escV, setEscV] = useState(11.2);
  const [orbV, setOrbV] = useState(7.67);
  const [challenge, setChallenge] = useState<string | null>(null);

  // mission evaluation loop
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useStore.getState();
      const m = s.activeMission;
      if (m == null) return;
      const tel = telemetry();
      const M = planetM(s), R = planetR(s);
      let done: MissionReport | null = null;
      const base = {
        travelTime: tel.t, maxAltKm: world.maxAlt / 1000, maxV: world.maxV,
        dV: tel.dV, finalEnergy: tel.E, classification: tel.status,
        detail: "",
      };
      if (tel.launched && !tel.alive) {
        done = { ...base, mission: `MISSION 0${m}`, status: "FAILED", detail: "Trajectory intersected the surface. Periapsis was inside the planet — raise burn velocity toward circular speed." };
      } else if (m === 1 && tel.elems && tel.elems.rp - R >= 350e3 && tel.elems.ra - R <= 500e3 && tel.elems.e < 0.03 && tel.t > 60) {
        done = { ...base, mission: "MISSION 01", status: "COMPLETE", detail: "Stable near-circular 400 km orbit confirmed from live orbital elements." };
      } else if (m === 2 && tel.elems && tel.elems.eps >= 0 && tel.dist > 3 * R) {
        done = { ...base, mission: "MISSION 02", status: "COMPLETE", detail: "Specific energy ≥ 0 past 3R — the craft is on an open escape trajectory." };
      } else if (m === 3) {
        const p = viewState().pos;
        const dm = Math.hypot(p.x - moonPos().x, p.y - moonPos().y, p.z - moonPos().z);
        if (dm < 2e7) done = { ...base, mission: "MISSION 03", status: "COMPLETE", detail: `Lunar encounter — closest approach ${fmtKm(dm)}.` };
      } else if (m === 4 && world.history.length > 40) {
        const E0 = world.history[0].E;
        let drift = 0;
        for (const h of world.history) drift = Math.max(drift, Math.abs((h.E - E0) / E0));
        if (tel.t > 60 && tel.launched && tel.alive) {
          done = drift < 0.01
            ? { ...base, mission: "MISSION 04", status: "COMPLETE", detail: `Energy conserved to ${(drift * 100).toFixed(3)}% by the Verlet integrator.` }
            : { ...base, mission: "MISSION 04", status: "FAILED", detail: `Energy drift ${(drift * 100).toFixed(2)}% — trajectory perturbed (drag/third body?) or unbound.` };
        }
      }
      if (done) {
        s.addEntry({
          title: `${done.mission} REPORT`, objective: MISSIONS[m - 1].obj,
          given: `Δv budget used ${fmt(done.dV, 0)} m/s`, formula: "ε=v²/2−GM/r · Kepler III",
          calc: `t ${fmtTime(done.travelTime)} · max alt ${fmt(done.maxAltKm, 0)} km · max v ${fmt(done.maxV / 1000, 2)} km/s`,
          observation: done.detail, conclusion: `Status: ${done.status}`, note: "",
        });
        s.setLastReport(done);
        s.setActiveMission(null);
        done.status === "COMPLETE" ? sfx.confirm() : sfx.warn();
      }
    }, 400);
    return () => clearInterval(iv);
  }, []);

  const M = planetM(st), R = planetR(st);

  return (
    <div>
      <Section title="Mission Control">
        {MISSIONS.map((m) => (
          <div key={m.id} className="flex items-start gap-2 py-1.5 border-b border-line/40">
            <div className={`w-1.5 h-1.5 mt-1.5 ${st.activeMission === m.id ? "bg-amber blink" : "bg-line2"}`} />
            <div className="flex-1">
              <div className="readout text-[10.5px] text-cyan2 tracking-[0.12em]">{m.name} {st.activeMission === m.id && <span className="text-amber2">· ACTIVE</span>}</div>
              <div className="readout text-[8.5px] text-ink3">{m.obj}</div>
            </div>
            <button className="btn !px-2 !py-1 !text-[8px]" onClick={() => { st.setActiveMission(m.id); st.setMode("ORBIT"); sfx.confirm(); }}>
              {st.activeMission === m.id ? "ARMED" : "ACTIVATE"}
            </button>
          </div>
        ))}
        {st.activeMission && <div className="readout text-[8.5px] text-amber2 mt-1.5">Launch from the ORBIT module — objectives evaluate live against integrated state.</div>}
        <button className="btn w-full mt-2" onClick={() => { st.setLastReport(null); sfx.click(); }} disabled={!st.lastReport}>DISMISS REPORT</button>
      </Section>

      <Section title="Escape Challenge — minimum speed to leave">
        <Slider label="Launch speed (vertical, surface)" value={escV} min={5} max={20} step={0.05} unit="km/s" amber onChange={setEscV} />
        <Kv k="Ideal vₑ = √(2GM/R)" v={fmt(escapeV(M, R) / 1000, 3)} unit="km/s" />
        <button className="btn primary w-full" onClick={() => {
          launch({ altM: 0, speed: escV * 1000, angleDeg: 90, lat: st.site?.lat ?? 0, lon: st.site?.lon ?? 0 });
          st.setCamera("DEEP"); st.setRunning(true); setChallenge("escape"); sfx.launch();
        }}>▲ RUN ESCAPE ATTEMPT</button>
        {challenge === "escape" && t.launched && <EscapeScore v={escV} status={t.status} eps={t.elems?.eps ?? 0} />}
        <p className="readout text-[8.5px] text-ink3 mt-1.5">vₑ is the idealized, atmosphere-free speed from a non-rotating surface. Real launches lose Δv to drag, gravity and steering — enable the drag model to see part of that.</p>
      </Section>

      <Section title="Orbit Challenge — stable 400 km">
        <Slider label="Launch speed at 400 km, horizontal" value={orbV} min={5} max={11} step={0.01} unit="km/s" onChange={setOrbV} />
        <Kv k="Required v = √(GM/r)" v={fmt(circV(M, R + 4e5) / 1000, 3)} unit="km/s" />
        <button className="btn primary w-full" onClick={() => {
          launch({ altM: 400e3, speed: orbV * 1000, angleDeg: 0, lat: st.site?.lat ?? 0, lon: st.site?.lon ?? 0 });
          st.setCamera("ORBIT"); st.setRunning(true); setChallenge("orbit"); sfx.launch();
        }}>▲ INSERT SATELLITE</button>
        {challenge === "orbit" && t.launched && (
          <div className="mt-2 flex items-center justify-between">
            <span className="lbl">Result</span>
            <ClsBadge cls={t.status} />
          </div>
        )}
      </Section>

      <GravityQuiz />
    </div>
  );
}

function EscapeScore({ v, status, eps }: { v: number; status: string; eps: number }) {
  const st = useStore.getState();
  const ve = escapeV(planetM(st), planetR(st)) / 1000;
  const escaped = eps >= 0 || status === "ESCAPE";
  const score = escaped ? Math.round(100 * clamp(ve / v, 0, 1)) : 0;
  return (
    <div className="mt-2 border border-line2 p-2 readout text-[9.5px] rise-in">
      <div className="flex justify-between"><span className="lbl">Efficiency score</span><span className={escaped ? "text-ok" : "text-danger"}>{score}/100</span></div>
      <div className="text-ink3 mt-0.5">{escaped ? `Escaped with margin ${(v - ve).toFixed(2)} km/s. Minimum is ${ve.toFixed(2)} km/s.` : status === "IMPACT" ? "Rocket rose, slowed, fell back — below escape speed." : "Climbing… watch it decelerate against the field."}</div>
    </div>
  );
}

/* ================= GRAVITY QUIZ ================= */
function GravityQuiz() {
  const st = useStore();
  const M = planetM(st), R = planetR(st);
  const [qi, setQi] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);

  const quiz = useMemo(() => {
    const g = gravAccel(M, R);
    const r1000 = R + 1e6, r400 = R + 4e5;
    const mk = (q: string, correct: number, wrong: number[], unit: string) => {
      const opts = [correct, ...wrong];
      const idx = qi % 4; // rotate so the correct option moves around
      const arr = [...opts.slice(idx), ...opts.slice(0, idx)];
      return { q, unit, arr, correct };
    };
    return [
      mk("What is g at 1000 km altitude?", gravAccel(M, r1000), [g * (R / r1000), g / 2, g * 0.9], "m/s²"),
      mk("Circular speed at 400 km?", circV(M, r400) / 1000, [circV(M, r400) / 1000 * 1.41, escapeV(M, R) / 1000, 3.1], "km/s"),
      mk("Earth mass ×2, radius same → surface g?", 2 * g, [g, 4 * g, 1.41 * g], "m/s²"),
      mk("70 kg person on Mars weighs…", 70 * gravAccel(BODIES.mars.M, BODIES.mars.R), [70 * 9.81, 70 * 2.1, 70 * 5.2], "N"),
      mk("Mass ×2 → escape velocity becomes…", escapeV(2 * M, R) / 1000, [2 * escapeV(M, R) / 1000, escapeV(M, R) / 1000, 4 * escapeV(M, R) / 1000], "km/s"),
    ];
  }, [M, R, qi]);

  const cur = quiz[qi % quiz.length];
  return (
    <Section title="Gravity Challenge — score your physics" right={<span className="readout text-[10px] text-amber2">{score} pts</span>}>
      <div className="readout text-[10.5px] text-ink mb-2">{cur.q}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {cur.arr.map((v, i) => (
          <button key={i} disabled={answered != null}
            className={`btn !text-[9px] ${answered != null && Math.abs(v - cur.correct) < Math.abs(cur.correct) * 1e-6 ? "primary" : answered === i ? "danger" : ""}`}
            onClick={() => {
              setAnswered(i);
              const ok = Math.abs(v - cur.correct) < Math.abs(cur.correct) * 1e-6;
              if (ok) { setScore((x) => x + 20); sfx.confirm(); } else sfx.warn();
              setTimeout(() => { setAnswered(null); setQi((x) => x + 1); }, 900);
            }}>
            {fmt(v, 2)} {cur.unit}
          </button>
        ))}
      </div>
    </Section>
  );
}

/* ================= DATA MODULE ================= */
export function DataModule() {
  const st = useStore();
  const t = useTelemetry(250);
  const M = planetM(st), R = planetR(st);
  const rotP = 86164.0905 / st.rotMult;
  const [exp, setExp] = useState<null | { label: string; rows: [string, string][] }>(null);

  const E0 = world.history.length ? world.history[0].E : t.E;
  const drift = E0 !== 0 ? ((t.E - E0) / Math.abs(E0)) * 100 : 0;

  const eqs: { f: string; v: string; vars: { sym: string; hl: string; mode?: any }[] }[] = [
    { f: "F = GMm/r²", v: `${fmt(t.force, 2)} N`, vars: [{ sym: "M", hl: "mass", mode: "WHATIF" }, { sym: "r", hl: "alt", mode: "ORBIT" }] },
    { f: "g = GM/r²", v: `${fmt(t.accel, 4)} m/s²`, vars: [{ sym: "M", hl: "mass", mode: "WHATIF" }] },
    { f: "W = mg (70 kg)", v: `${fmt(70 * gravAccel(M, R), 1)} N`, vars: [{ sym: "g", hl: "mass", mode: "WHATIF" }] },
    { f: "vₑ = √(2GM/R)", v: `${fmt(escapeV(M, R) / 1000, 3)} km/s`, vars: [{ sym: "M", hl: "mass", mode: "WHATIF" }, { sym: "R", hl: "radius", mode: "WHATIF" }] },
    { f: "v = √(GM/r)", v: `${fmt(circV(M, R + st.altKm * 1000) / 1000, 3)} km/s`, vars: [{ sym: "r", hl: "alt", mode: "ORBIT" }] },
    { f: "K = ½mv²", v: fmt(t.K, 2) + " J", vars: [{ sym: "v", hl: "velocity", mode: "ORBIT" }] },
    { f: "U = −GMm/r", v: fmt(t.U, 2) + " J", vars: [{ sym: "M", hl: "mass", mode: "WHATIF" }] },
    { f: "ω = 2π/T", v: `${fmt((2 * Math.PI) / rotP, 6)} rad/s`, vars: [{ sym: "T", hl: "rotation", mode: "WHATIF" }] },
  ];

  const hm = hohmann(SUN.M, AU, 1.524 * AU);

  return (
    <div>
      <Section title="Energy Lab — conservation live">
        <div className="grid grid-cols-3 gap-1.5 mb-2 text-center">
          <div className="border border-line p-1.5"><div className="lbl">K ½mv²</div><div className="readout text-[10.5px] text-cyan2">{fmt(t.K / 1e9, 2)}G</div></div>
          <div className="border border-line p-1.5"><div className="lbl">U −GMm/r</div><div className="readout text-[10.5px] text-amber2">{fmt(t.U / 1e9, 2)}G</div></div>
          <div className="border border-line p-1.5"><div className="lbl">E = K+U</div><div className="readout text-[10.5px] text-ok">{fmt(t.E / 1e9, 2)}G</div></div>
        </div>
        <Kv k="Total energy drift" v={`${drift >= 0 ? "+" : ""}${drift.toFixed(3)}%`} amber={Math.abs(drift) > 1} />
        <p className="readout text-[8.5px] text-ink3 mt-1">Ideal isolated orbit: E constant, K and U trade. Drift &gt;1% means drag or a third body is active.</p>
      </Section>

      <Section title="Orbit graphs · click a point to time-travel">
        <SimGraph title="ENERGY vs TIME" height={104} series={[
          { key: "K", label: "K", color: "#5fe0ff", get: (s) => s.K },
          { key: "U", label: "U", color: "#ffb648", get: (s) => s.U },
          { key: "E", label: "E", color: "#7dffa8", get: (s) => s.E },
        ]} />
        <div className="h-2" />
        <SimGraph title="VELOCITY / ALTITUDE vs TIME" height={104} series={[
          { key: "v", label: "v", color: "#9beaff", get: (s) => s.speed / 1000 },
          { key: "alt", label: "alt", color: "#ffd9a0", get: (s) => s.alt / 1000 },
        ]} />
      </Section>

      <Section title="Equation Explorer — every symbol is live">
        {eqs.map((e) => (
          <div key={e.f} className="flex items-center justify-between py-1 border-b border-line/40">
            <div className="flex items-center gap-2">
              <span className="readout text-[11px] text-ink">{e.f}</span>
              {e.vars.map((v) => (
                <button key={v.sym} className="readout text-[8.5px] text-amber2 border border-amber/40 px-1 hover:bg-amber/15"
                  onClick={() => { st.setHighlight(v.hl); if (v.mode) st.setMode(v.mode); sfx.tick(); setTimeout(() => st.setHighlight(null), 2500); }}>
                  {v.sym}
                </button>
              ))}
            </div>
            <span className="readout text-[10px] text-cyan2">{e.v}</span>
          </div>
        ))}
      </Section>

      <Section title="Hohmann Transfer · Earth → Mars (idealized)">
        <div className="flex gap-3 items-center">
          <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
            <circle cx="55" cy="55" r="4" fill="#ffd98a" />
            <circle cx="55" cy="55" r="26" fill="none" stroke="#5fe0ff" strokeWidth="1" />
            <circle cx="55" cy="55" r="47" fill="none" stroke="#ff6b5e" strokeWidth="1" strokeDasharray="3 3" />
            <ellipse cx="66.5" cy="55" rx="36.5" ry="36.5" fill="none" stroke="#ffb648" strokeWidth="1.2" strokeDasharray="5 3" transform="rotate(0 55 55)" />
            <path d={`M 81 55 A 36.5 36.5 0 0 1 29.5 82`} fill="none" stroke="#ffb648" strokeWidth="1.6" />
            <circle cx="81" cy="55" r="3" fill="#5fe0ff" />
            <circle cx="19" cy="88" r="2.5" fill="#ff6b5e" />
          </svg>
          <div className="flex-1">
            <Kv k="Δv₁ (departure burn)" v={fmt(hm.dv1 / 1000, 2)} unit="km/s" amber />
            <Kv k="Δv₂ (arrival burn)" v={fmt(hm.dv2 / 1000, 2)} unit="km/s" amber />
            <Kv k="Total Δv" v={fmt(hm.dvTotal / 1000, 2)} unit="km/s" />
            <Kv k="Transfer time ½T" v={fmtTime(hm.transferTime)} />
            <Kv k="Phase angle" v={`${hm.phaseAngle.toFixed(1)}°`} />
          </div>
        </div>
        <p className="readout text-[8.5px] text-ink3 mt-1.5">Two-body, coplanar, circular-orbit approximation with the Sun as only mass. Real missions add plane changes, finite burns and planetary SOIs.</p>
      </Section>

      <Section title="Mission Scientist — onboard analysis">
        <div className="flex gap-1.5 flex-wrap mb-2">
          <button className="btn !text-[8px]" onClick={() => { setExp(null); analyze(); sfx.click(); }}>WHY DID MY SATELLITE CRASH?</button>
          <button className="btn !text-[8px]" onClick={() => {
            const rows: [string, string][] = [0.5, 1, 2, 4].map((f) => [`${f}× M`, `${fmt(escapeV(M * f, R) / 1000, 3)} km/s`]);
            setExp({ label: "vₑ vs MASS — R fixed", rows }); sfx.confirm();
          }}>EXPERIMENT: vₑ VS MASS</button>
        </div>
        <AdvisorBox />
        {exp && (
          <div className="border border-line2 p-2 mt-2 rise-in">
            <div className="lbl !text-amber2 mb-1">{exp.label} — computed from vₑ = √(2GM/R)</div>
            {exp.rows.map(([a, b]) => (
              <div key={a} className="flex justify-between readout text-[10px] py-0.5 border-b border-line/30">
                <span className="text-ink2">{a}</span><span className="text-cyan2">{b}</span>
              </div>
            ))}
            <div className="readout text-[8.5px] text-ink3 mt-1">Doubling mass raises vₑ by √2 ≈ 1.414× — the square-root signature of the energy law.</div>
          </div>
        )}
      </Section>

      <Section title="Scientific Notebook">
        {st.entries.length === 0 && <div className="readout text-[9px] text-ink3">No experiments logged yet. Launch a craft or run a WHAT-IF.</div>}
        {st.entries.map((e) => (
          <details key={e.id} className="border border-line/60 mb-1.5 bg-hull/50">
            <summary className="readout text-[9.5px] text-cyan2 px-2 py-1.5 cursor-pointer flex justify-between">
              <span>{e.title}</span><span className="text-ink3">{e.stamp}</span>
            </summary>
            <div className="px-2 pb-2 readout text-[8.5px] text-ink2 space-y-0.5">
              <div><span className="text-ink3">OBJECTIVE · </span>{e.objective}</div>
              <div><span className="text-ink3">GIVEN · </span>{e.given}</div>
              <div><span className="text-ink3">FORMULA · </span>{e.formula}</div>
              <div><span className="text-ink3">CALC · </span>{e.calc}</div>
              <div><span className="text-ink3">OBSERVATION · </span>{e.observation}</div>
              <div><span className="text-ink3">CONCLUSION · </span>{e.conclusion}</div>
              <textarea className="nin mt-1 h-10 resize-none" placeholder="your notes…" value={e.note} onChange={(ev) => st.setEntryNote(e.id, ev.target.value)} />
            </div>
          </details>
        ))}
      </Section>

      <Section title="Assumptions & Model">
        {[
          "Newtonian gravity; point-mass planet (spherical symmetry)",
          "Two-body problem unless Moon/Sun gravity toggled on",
          "Velocity-Verlet integration, dt = 3 s — numerical, not analytic",
          "Local jumps use constant-g approximation (h ≪ R)",
          "Atmosphere: exponential ρ model, educational; Kármán line for scale",
          "Tidal bulge visual exaggerated ~40 000× — printed values are model-true",
          "Rotation visualization time-scaled; physics uses true ω",
          "No relativity, no relativistic mass — modern terminology only",
        ].map((a, i) => (
          <div key={i} className="readout text-[8.5px] text-ink3 py-0.5 border-b border-line/30 flex gap-1.5">
            <span className="text-cyan/60">▸</span>{a}
          </div>
        ))}
      </Section>
    </div>
  );
}

function AdvisorBox() {
  const [txt, setTxt] = useState("Ask the engine a question about the current flight — analysis reads live state.");
  return <div className="readout text-[9.5px] text-cyan2/90 border border-cyan/30 bg-cyan/5 p-2 leading-relaxed min-h-[54px]">{txt}<AdvisorInner set={setTxt} /></div>;
}
function AdvisorInner({ set }: { set: (s: string) => void }) {
  useEffect(() => {
    const analyze = () => {
      const s = useStore.getState();
      const t = telemetry();
      const M = planetM(s), R = planetR(s);
      if (!t.launched) { set("No active flight. Set altitude and velocity in the ORBIT module, then launch — I will read the trajectory live."); return; }
      if (!t.alive) {
        const vc = circV(M, R + (world.launchInfo?.altKm ?? 0) * 1000) / 1000;
        set(`Impact confirmed. Your burn gave ${(world.launchInfo?.speedKms ?? 0).toFixed(2)} km/s at ${world.launchInfo?.altKm ?? 0} km; circular speed there is ${vc.toFixed(2)} km/s. Periapsis fell inside R=${fmtKm(R)} — the conic section intersected the surface. Add ~${fmt(Math.max(0, vc - (world.launchInfo?.speedKms ?? 0)), 2)} km/s.`);
        return;
      }
      if (t.status === "ESCAPE") { set(`Not a crash — escape. Specific energy ε = ${fmt(t.elems?.eps ?? 0, 2)} J/kg ≥ 0, speed ${fmt(t.speed / 1000, 2)} km/s ≥ vₑ = ${fmt(escapeV(M, t.dist) / 1000, 2)} km/s at current r. The trajectory is an open hyperbola.`); return; }
      if (t.status === "CIRCULAR" || t.status === "ELLIPTICAL") {
        set(`Orbit is ${t.status.toLowerCase()}: e=${t.elems?.e.toFixed(4)}, period ${t.elems?.period ? fmtTime(t.elems.period) : "—"}, periapsis ${fmtKm((t.elems?.rp ?? 0) - R)} above surface. Energy drift ${(((t.E - world.history[0].E) / Math.abs(world.history[0].E)) * 100).toFixed(3)}% — integrator is conserving well.`);
        return;
      }
      set(`Status ${t.status}: periapsis ${fmtKm((t.elems?.rp ?? 0) - R)} — ${t.elems && t.elems.rp < R ? "below surface, an impact is scheduled unless you burn prograde now" : "above surface, you are in a ballistic arc"}.`);
    };
    const iv = setInterval(analyze, 1600);
    analyze();
    return () => clearInterval(iv);
  }, [set]);
  return null;
}
function analyze() { /* kept for explicit refresh */ }
void analyze; void G;
