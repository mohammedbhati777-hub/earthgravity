import { useEffect, useState } from "react";
import { useStore, type Mode } from "../state/store";
import world, { resetCraft, scrubTo, resumeFromScrub, launch, burn, type Telemetry } from "../state/world";
import { fmt, fmtKm, fmtTime, gravAccel, clamp } from "../physics/core";
import { sfx, useTelemetry } from "./widgets";
import { ClsBadge, OrbitModule, FieldModule, ProbeModule } from "./modules-a";
import { WeightModule, MoonModule, WhatIfModule } from "./modules-b";
import { MissionsModule, DataModule } from "./modules-c";
import { planetM } from "../state/store";

const MODES: { id: Mode; label: string }[] = [
  { id: "ORBIT", label: "ORBIT" }, { id: "FIELD", label: "FIELD" }, { id: "PROBE", label: "PROBE" },
  { id: "WEIGHT", label: "WEIGHT" }, { id: "MOON", label: "MOON" }, { id: "WHATIF", label: "WHAT-IF" },
  { id: "MISSIONS", label: "MISSIONS" }, { id: "DATA", label: "DATA" },
];
const SPEEDS = [0.1, 1, 10, 60, 300, 1000];

/* ---------- left telemetry rail ---------- */
function RailRow({ k, v, frac, unit }: { k: string; v: string; frac: number; unit?: string }) {
  return (
    <div className="mb-2.5 group">
      <div className="lbl group-hover:text-ink2 transition-colors">{k}</div>
      <div className="readout text-[12px] text-cyan2 leading-tight">{v}{unit && <span className="text-[8px] text-ink3 ml-1">{unit}</span>}</div>
      <div className="h-[3px] bg-hull border border-line/50 mt-0.5 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-cyandim to-cyan transition-all duration-300" style={{ width: `${clamp(frac * 100, 0, 100)}%` }} />
      </div>
    </div>
  );
}
function TelemetryRail({ t }: { t: Telemetry }) {
  const st = useStore();
  const M = planetM(st);
  const gSurf = gravAccel(M, 6.371e6 * st.radiusMult);
  return (
    <div className="absolute left-3 top-16 bottom-28 w-36 hidden md:block z-20 pointer-events-none">
      <div className="panel chamfer-sm p-3 corners">
        <div className="panel-title mb-2 !text-[8px]">TELEMETRY · LIVE</div>
        <RailRow k="Altitude" v={t.launched ? fmtKm(t.alt) : "—"} frac={Math.log10(1 + t.alt / 1e4) / 7} />
        <RailRow k="Distance r" v={t.launched ? fmtKm(t.dist) : "—"} frac={Math.log10(t.dist / 6.371e6) / 3} />
        <RailRow k="Velocity" v={t.launched ? (t.speed / 1000).toFixed(3) : "—"} unit="km/s" frac={t.speed / 16000} />
        <RailRow k="Accel g(r)" v={t.launched ? fmt(t.accel, 3) : "—"} unit="m/s²" frac={t.accel / (gSurf * 1.2)} />
        <RailRow k="Force" v={t.launched ? fmt(t.force, 1) : "—"} unit="N" frac={t.force / (st.craftMass * gSurf * 1.2)} />
        <RailRow k="Energy E" v={t.launched ? fmt(t.E / 1e9, 2) + "G" : "—"} unit="J" frac={t.launched ? 0.5 + (t.E / Math.abs(t.U || 1)) : 0} />
        <div className="flex justify-between items-center mt-1">
          <span className="lbl">Status</span>
          <ClsBadge cls={t.launched ? t.status : "READY"} />
        </div>
        <div className="readout text-[8px] text-ink3 mt-2">SCIENTIFIC DATA STREAM<br />Δv used {fmt(t.dV, 0)} m/s</div>
      </div>
    </div>
  );
}

/* ---------- bottom dock ---------- */
function Dock({ t }: { t: Telemetry }) {
  const st = useStore();
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
      <div className="mx-2 mb-2 pointer-events-auto">
        <div className="panel chamfer px-3 py-2 flex items-center gap-3 flex-wrap">
          {/* transport */}
          <div className="flex items-center gap-1.5">
            <button className={`btn !px-3 ${st.running ? "" : "primary"}`} onClick={() => { st.setRunning(!st.running); sfx.click(); }} aria-label="play/pause">
              {st.running ? "❚❚" : "▶"}
            </button>
            <button className="btn !px-3" onClick={() => { resetCraft(); sfx.warn(); }} aria-label="reset">⟲ RESET</button>
          </div>
          <div className="seg w-56">
            {SPEEDS.map((s) => (
              <button key={s} className={st.speed === s ? "on" : ""} onClick={() => { st.setSpeed(s); sfx.tick(); }}>{s}×</button>
            ))}
          </div>
          <div className="readout text-[11px] text-amber2 w-24">T+{fmtTime(t.t)}</div>

          {/* scrubber */}
          <div className="flex-1 min-w-40 flex items-center gap-2">
            <span className="lbl shrink-0">TIME SCRUB</span>
            <input
              type="range" className="dial amber flex-1" min={0} max={Math.max(1, t.histLen - 1)} step={1}
              value={t.scrub ?? Math.max(0, t.histLen - 1)}
              disabled={t.histLen < 2}
              onChange={(e) => {
                if (st.running) st.setRunning(false);
                scrubTo(parseInt(e.target.value));
                sfx.tick();
              }}
              aria-label="time scrubber"
            />
            {t.scrub != null && (
              <button className="btn amber !px-2 !py-1 !text-[8px]" onClick={() => { resumeFromScrub(); st.setRunning(true); sfx.confirm(); }}>RESUME</button>
            )}
          </div>
          <div className="hidden lg:flex items-center gap-2">
            <span className="lbl">Orbit status</span>
            <ClsBadge cls={t.launched ? t.status : "READY"} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- right module panel ---------- */
function ModulePanel() {
  const st = useStore();
  const mod = MODES.find((m) => m.id === st.mode)!;
  return (
    <div className={`absolute right-0 top-14 bottom-24 z-20 pointer-events-auto overflow-hidden transition-all duration-300 ${st.panelOpen ? "w-[336px]" : "w-0"}`}>
      <div className="h-full panel border-r-0 flex flex-col" style={{ clipPath: "polygon(16px 0, 100% 0, 100% 100%, 16px 100%, 0 calc(100% - 16px), 0 16px)" }}>
        <div className="px-4 py-2.5 border-b border-line flex items-center justify-between shrink-0">
          <div className="panel-title">{mod.label} MODULE</div>
          <button className="btn !px-2 !py-0.5 !text-[8px]" onClick={() => { st.setPanelOpen(false); sfx.click(); }}>—</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {st.mode === "ORBIT" && <OrbitModule />}
          {st.mode === "FIELD" && <FieldModule />}
          {st.mode === "PROBE" && <ProbeModule />}
          {st.mode === "WEIGHT" && <WeightModule />}
          {st.mode === "MOON" && <MoonModule />}
          {st.mode === "WHATIF" && <WhatIfModule />}
          {st.mode === "MISSIONS" && <MissionsModule />}
          {st.mode === "DATA" && <DataModule />}
        </div>
      </div>
      {!st.panelOpen && null}
    </div>
  );
}

/* ---------- expo mode ---------- */
interface ExpoStep { title: string; body: string; run: () => void }
const EXPO: ExpoStep[] = [
  { title: "1 · MEET EARTH", body: "One planet, rendered from real constants: M = 5.972×10²⁴ kg, R = 6371 km. Every number in this room is computed, not scripted.", run: () => { const s = useStore.getState(); s.setCamera("PLANET"); s.setMode("FIELD"); s.setPlanet({ massMult: 1, radiusMult: 1, rotMult: 1, hasMoon: true, moonMassMult: 1, moonDistMult: 1, focusBody: "earth" }); } },
  { title: "2 · THE GRAVITY FIELD", body: "Newton's field fills space: g = GM/r². Lines are radial because a sphere pulls symmetrically; strength falls with the square of distance.", run: () => { const s = useStore.getState(); s.setMode("FIELD"); s.setField({ fieldVis: "LINES", fieldPlane: "OFF" }); s.setCamera("FIELD"); } },
  { title: "3 · SEND THE PROBE", body: "Drag the amber probe. Distance, local g, potential and escape velocity update from the equations in real time.", run: () => { const s = useStore.getState(); s.setMode("PROBE"); s.setProbe({ x: 2.1, y: 0.3, z: 0.4 }); } },
  { title: "4 · CLIMB TO 4000 KM", body: "Raise the altitude slider. Gravity does not vanish in orbit — at 4000 km it is still a quarter of surface strength.", run: () => { const s = useStore.getState(); s.setMode("FIELD"); s.setOrbit({ altKm: 4000 }); } },
  { title: "5 · MASS VS WEIGHT", body: "A 70 kg human keeps their mass everywhere. Weight = mg changes with the body: 686 N on Earth, 114 N on the Moon.", run: () => { const s = useStore.getState(); s.setMode("WEIGHT"); s.setWeight({ massKg: 70, jumpV: 3 }); } },
  { title: "6 · LAUNCH A SATELLITE", body: "400 km altitude, 7.67 km/s horizontal — right at circular speed v = √(GM/r). The integrator takes over; nothing below is animated by hand.", run: () => { const s = useStore.getState(); s.setMode("ORBIT"); s.setOrbit({ altKm: 400, speedKms: 7.67, angleDeg: 0 }); s.setCamera("ORBIT"); launch({ altM: 400e3, speed: 7670, angleDeg: 0, lat: 28.5, lon: -80.6 }); sfx.launch(); } },
  { title: "7 · STABLE ORBIT", body: "Specific energy is negative, periapsis clears the surface: a bound conic section. K and U trade while E stays flat on the graph.", run: () => { const s = useStore.getState(); s.setSpeed(300); s.setCamera("ORBIT"); } },
  { title: "8 · RETRO BURN", body: "Fire −500 m/s against the velocity vector. The orbit stretches into an ellipse — watch periapsis fall and speed oscillate.", run: () => { burn(-500); sfx.warn(); } },
  { title: "9 · ESCAPE EARTH", body: "From the surface, 11.6 km/s straight up — beyond vₑ = √(2GM/R) ≈ 11.19 km/s. The rocket never turns back.", run: () => { const s = useStore.getState(); launch({ altM: 0, speed: 11600, angleDeg: 90, lat: 0, lon: 0 }); s.setCamera("DEEP"); s.setSpeed(300); sfx.launch(); } },
  { title: "10 · DOUBLE THE MASS", body: "WHAT-IF EARTH had 2× mass at the same radius? The engine recalculates the whole system: g doubles, escape climbs by √2.", run: () => { const s = useStore.getState(); s.setMode("WHATIF"); s.setPlanet({ massMult: 2 }); s.setCamera("PLANET"); sfx.confirm(); } },
  { title: "11 · THE NEW GRAVITY", body: "Surface g is now ≈ 19.6 m/s². The gravity meter, the field, the escape lab — all respond to the same constant change.", run: () => { const s = useStore.getState(); s.setMode("FIELD"); s.setOrbit({ altKm: 0 }); s.setCamera("FIELD"); } },
  { title: "12 · RESTORE THE MOON", body: "384 400 km away, the Moon trades pull with Earth: F = GMm/d² ≈ 2×10²⁰ N — the same force on both bodies.", run: () => { const s = useStore.getState(); s.setPlanet({ massMult: 1, hasMoon: true }); s.setCamera("DEEP"); s.setMode("MOON"); } },
  { title: "13 · TIDAL FIELD", body: "Tides are a difference: the near side is pulled harder than the far side. Double lunar mass and the differential field doubles too.", run: () => { const s = useStore.getState(); s.setPlanet({ moonMassMult: 2 }); } },
  { title: "14 · PERTURBED FLIGHT", body: "Enable Moon and Sun gravity on a craft and the two-body conic breaks — a real N-body trajectory, summed force by force each step.", run: () => { const s = useStore.getState(); s.setOrbit({ moonGrav: true, sunGrav: true, altKm: 60000, speedKms: 3.4, angleDeg: 0 }); s.setMode("ORBIT"); launch({ altM: 6e7, speed: 3400, angleDeg: 0, lat: 0, lon: 90 }); s.setCamera("DEEP"); s.setSpeed(1000); } },
  { title: "15 · WHAT IF EARTH…?", body: "The signature question. Change one variable and the physics changes everything. The planet is the interface — press FINAL MOMENT in the WHAT-IF module.", run: () => { const s = useStore.getState(); s.setOrbit({ moonGrav: false, sunGrav: false }); s.setMode("WHATIF"); s.setCamera("PLANET"); } },
];

function ExpoOverlay() {
  const st = useStore();
  const i = st.expoStep;
  useEffect(() => {
    if (i >= 0 && i < EXPO.length) EXPO[i].run();
  }, [i]);
  if (i < 0) return null;
  const step = EXPO[clamp(i, 0, EXPO.length - 1)];
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 w-[min(640px,92vw)]">
      <div className="panel chamfer p-4 corners border-amber/40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="readout text-[9px] tracking-[0.3em] text-amber2">EXPO MODE · {i + 1}/{EXPO.length}</span>
          <div className="flex gap-0.5">{EXPO.map((_, k) => <span key={k} className={`w-2 h-[3px] ${k <= i ? "bg-amber" : "bg-line2"}`} />)}</div>
        </div>
        <div className="font-display text-[13px] tracking-[0.14em] text-ink mb-1">{step.title}</div>
        <div className="readout text-[11px] text-ink2 leading-relaxed mb-3">{step.body}</div>
        <div className="flex gap-2">
          <button className="btn flex-1" disabled={i === 0} onClick={() => { st.setExpoStep(i - 1); sfx.click(); }}>◀ PREV</button>
          <button className="btn flex-1" onClick={() => { st.setRunning(!st.running); sfx.tick(); }}>{st.running ? "PAUSE SIM" : "RESUME SIM"}</button>
          {i < EXPO.length - 1
            ? <button className="btn primary flex-1" onClick={() => { st.setExpoStep(i + 1); sfx.confirm(); }}>NEXT ▶</button>
            : <button className="btn amber flex-1" onClick={() => { st.setExpoStep(-1); st.setFinalMoment(true); sfx.confirm(); }}>FINISH ★</button>}
          <button className="btn !px-2" onClick={() => { st.setExpoStep(-1); sfx.click(); }}>EXIT</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- final moment ---------- */
function FinalMoment() {
  const st = useStore();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!st.finalMoment) { setPhase(0); return; }
    const t1 = setTimeout(() => setPhase(1), 400);
    const t2 = setTimeout(() => setPhase(2), 2200);
    const t3 = setTimeout(() => setPhase(3), 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [st.finalMoment]);
  if (!st.finalMoment) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#020409]/82 backdrop-blur-[2px]" onClick={() => st.setFinalMoment(false)}>
      <div className="text-center px-6">
        <div className={`font-display tracking-[0.2em] text-[clamp(18px,3.4vw,34px)] text-ink transition-all duration-1000 ${phase >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
          YOU CHANGED ONE VARIABLE.
        </div>
        <div className={`font-display tracking-[0.2em] text-[clamp(18px,3.4vw,34px)] text-amber2 transition-all duration-1000 mt-4 ${phase >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
          THE PHYSICS CHANGED EVERYTHING.
        </div>
        <div className={`transition-all duration-1000 mt-10 ${phase >= 3 ? "opacity-100" : "opacity-0"}`}>
          <div className="font-display text-[clamp(14px,2vw,22px)] tracking-[0.3em] text-cyan2">EARTH: GRAVITY ENGINE</div>
          <div className="readout text-[11px] text-ink3 tracking-[0.3em] mt-2">CHANGE THE PLANET. WATCH PHYSICS RESPOND.</div>
          <div className="readout text-[9px] text-ink3/70 tracking-[0.2em] mt-8">CLICK TO RETURN TO THE CONTROL ROOM</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- report modal ---------- */
function ReportModal() {
  const st = useStore();
  const r = st.lastReport;
  if (!r) return null;
  const rows: [string, string][] = [
    ["STATUS", r.status], ["MISSION", r.mission], ["DETAIL", r.detail],
    ["TRAVEL TIME", fmtTime(r.travelTime)], ["MAX ALTITUDE", fmt(r.maxAltKm, 0) + " km"],
    ["MAX VELOCITY", fmt(r.maxV / 1000, 2) + " km/s"], ["Δv EXPENDED", fmt(r.dV, 0) + " m/s"],
    ["FINAL ENERGY", fmt(r.finalEnergy, 3) + " J"], ["TRAJECTORY", r.classification],
  ];
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#020409]/70" onClick={() => st.setLastReport(null)}>
      <div className="panel chamfer p-5 w-[min(440px,92vw)] corners rise-in" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title mb-1">MISSION REPORT</div>
        <div className={`font-display text-[16px] tracking-[0.2em] mb-3 ${r.status === "COMPLETE" ? "text-ok" : "text-danger"}`}>{r.status === "COMPLETE" ? "✓ OBJECTIVE MET" : "✕ MISSION FAILED"}</div>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1 border-b border-line/40">
            <span className="lbl shrink-0">{k}</span>
            <span className={`readout text-[10px] text-right ${k === "STATUS" ? (r.status === "COMPLETE" ? "text-ok" : "text-danger") : "text-cyan2"}`}>{v}</span>
          </div>
        ))}
        <button className="btn primary w-full mt-4" onClick={() => { st.setLastReport(null); sfx.click(); }}>CLOSE REPORT</button>
      </div>
    </div>
  );
}

/* ---------- help ---------- */
function HelpOverlay() {
  const st = useStore();
  if (!st.showHelp) return null;
  const keys: [string, string][] = [
    ["DRAG / TOUCH", "rotate view"], ["SCROLL / PINCH", "zoom"], ["RIGHT-DRAG", "pan"],
    ["CLICK PLANET", "set launch site"], ["DRAG AMBER PROBE", "move gravity probe"], ["DRAG RINGS", "set craft altitude"],
    ["SPACE", "pause / resume"], ["R", "reset craft"], ["1–8", "switch module"], ["[ / ]", "sim speed"], ["M", "mute"], ["H", "help"],
  ];
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#020409]/70" onClick={() => st.setShowHelp(false)}>
      <div className="panel chamfer p-5 w-[min(460px,92vw)] corners" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title mb-3">CONTROL ROOM MANUAL</div>
        <div className="grid grid-cols-2 gap-x-4">
          {keys.map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-line/30">
              <span className="readout text-[9.5px] text-amber2">{k}</span>
              <span className="readout text-[9px] text-ink2">{v}</span>
            </div>
          ))}
        </div>
        <p className="readout text-[8.5px] text-ink3 mt-3 leading-relaxed">
          RESPONSIBILITY: this is an educational Newtonian simulator. Exact two-body equations drive every readout; dynamics come from velocity-Verlet integration; the tidal bulge and rotation are visualized out of scale but labelled. No relativistic mass, no fabricated precision.
        </p>
        <button className="btn w-full mt-3" onClick={() => { st.setShowHelp(false); sfx.click(); }}>UNDERSTOOD</button>
      </div>
    </div>
  );
}

/* ---------- root HUD ---------- */
export default function Hud() {
  const st = useStore();
  const t = useTelemetry(150);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const s = useStore.getState();
      if (e.code === "Space") { e.preventDefault(); s.setRunning(!s.running); sfx.click(); }
      else if (e.key === "r" || e.key === "R") { resetCraft(); sfx.warn(); }
      else if (e.key === "h" || e.key === "H") s.setShowHelp(!s.showHelp);
      else if (e.key === "m" || e.key === "M") s.setMuted(!s.muted);
      else if (e.key === "[") s.setSpeed(SPEEDS[clamp(SPEEDS.indexOf(s.speed) - 1, 0, SPEEDS.length - 1)]);
      else if (e.key === "]") s.setSpeed(SPEEDS[clamp(SPEEDS.indexOf(s.speed) + 1, 0, SPEEDS.length - 1)]);
      else if (/^[1-8]$/.test(e.key)) { s.setMode(MODES[parseInt(e.key) - 1].id); sfx.tick(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none scanlines">
      {/* ambient instrument rings behind/over the scene */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[62vmin] h-[62vmin] rounded-full border border-dashed border-cyan/12 spin-slow absolute" />
        <div className="w-[86vmin] h-[86vmin] rounded-full border border-cyan/8 spin-slower absolute" />
        <div className="w-[86vmin] h-[86vmin] rounded-full absolute" style={{ background: "repeating-conic-gradient(rgba(95,224,255,0.10) 0deg 0.4deg, transparent 0.4deg 6deg)", WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 62.5%, black 63.4%, transparent 64%)", maskImage: "radial-gradient(circle, transparent 62%, black 62.5%, black 63.4%, transparent 64%)" }} />
        <div className="absolute w-px h-full bg-cyan/4" />
        <div className="absolute h-px w-full bg-cyan/4" />
      </div>
      <div className="absolute inset-0 vignette pointer-events-none" />

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: "linear-gradient(180deg, rgba(4,8,16,0.94), rgba(4,8,16,0.72))", borderBottom: "1px solid #1d3350" }}>
          <div className="mr-2 leading-none">
            <div className="font-display text-[11px] tracking-[0.24em] text-cyan2">EARTH: GRAVITY ENGINE</div>
            <div className="readout text-[7.5px] tracking-[0.28em] text-ink3 mt-0.5">3D PLANETARY PHYSICS SIMULATOR · CHANGE THE PLANET. WATCH PHYSICS RESPOND.</div>
          </div>
          <div className="seg flex-1 max-w-xl mx-auto hidden sm:flex">
            {MODES.map((m, i) => (
              <button key={m.id} className={st.mode === m.id ? "on" : ""} onClick={() => { st.setMode(m.id); sfx.click(); }} title={`${m.label} [${i + 1}]`}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="seg hidden md:flex">
            {(["PLANET", "ORBIT", "FIELD", "SURFACE", "DEEP"] as const).map((c) => (
              <button key={c} className={st.camera === c ? "on" : ""} onClick={() => { st.setCamera(c); sfx.tick(); }}>{c.slice(0, 3)}</button>
            ))}
          </div>
          <button className={`btn !px-3 ${st.expoStep >= 0 ? "amber" : ""}`} onClick={() => { st.setExpoStep(st.expoStep >= 0 ? -1 : 0); sfx.confirm(); }}>EXPO</button>
          <button className="btn !px-3" onClick={() => { st.setMuted(!st.muted); sfx.click(); }} aria-label="mute">{st.muted ? "MUTED" : "SND"}</button>
          <button className="btn !px-3" onClick={() => { st.setShowHelp(true); sfx.click(); }}>?</button>
          {!st.panelOpen && (
            <button className="btn !px-3" onClick={() => { st.setPanelOpen(true); sfx.click(); }}>PANEL</button>
          )}
        </div>
        {/* mobile mode strip */}
        <div className="sm:hidden flex gap-1 px-2 py-1 overflow-x-auto" style={{ background: "rgba(4,8,16,0.85)" }}>
          {MODES.map((m) => (
            <button key={m.id} className={`btn shrink-0 !px-2 !py-1 !text-[8px] ${st.mode === m.id ? "on" : ""}`} onClick={() => st.setMode(m.id)}>{m.label}</button>
          ))}
        </div>
      </div>

      {/* edge status */}
      <div className="absolute top-16 right-3 z-10 hidden lg:block pointer-events-none text-right">
        <div className="readout text-[8px] tracking-[0.25em] text-ink3">
          <span className={`inline-block w-1.5 h-1.5 mr-1.5 ${st.running ? "bg-ok" : "bg-amber"} ${st.running ? "blink" : ""}`} />
          {st.running ? `INTEGRATING · ${st.speed}×` : "HOLD"} · VERLET dt 3 s
        </div>
      </div>

      {hint && (
        <button
          className="absolute left-1/2 bottom-24 -translate-x-1/2 z-20 pointer-events-auto panel chamfer-sm px-4 py-2 readout text-[9.5px] tracking-[0.14em] text-cyan2/90 hover:text-cyan2 transition-colors"
          onClick={() => setHint(false)}
        >
          DRAG TO ORBIT · SCROLL TO ZOOM · CLICK THE PLANET TO SET A LAUNCH SITE · PRESS <span className="text-amber2">▲ LAUNCH</span> IN THE ORBIT MODULE — TAP TO DISMISS
        </button>
      )}
      <TelemetryRail t={t} />
      <Dock t={t} />
      <ModulePanel />
      <ExpoOverlay />
      <ReportModal />
      <HelpOverlay />
      <FinalMoment />
    </div>
  );
}
