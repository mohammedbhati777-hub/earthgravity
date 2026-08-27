import { useEffect, useRef, useState } from "react";
import world, { scrubTo, resumeFromScrub, telemetry, type Telemetry } from "../state/world";
import { useStore } from "../state/store";
import { fmt, fmtTime, clamp } from "../physics/core";

/* ================= SOUND ================= */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
  if (useStore.getState().muted) return;
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}
export const sfx = {
  click: () => tone(920, 0.05, "square", 0.03),
  tick: () => tone(1400, 0.025, "square", 0.018),
  confirm: () => { tone(660, 0.09, "sine", 0.05); setTimeout(() => tone(990, 0.14, "sine", 0.05), 90); },
  warn: () => { tone(220, 0.22, "sawtooth", 0.05, -80); },
  launch: () => { tone(120, 0.6, "sawtooth", 0.05, 700); tone(90, 0.7, "triangle", 0.06, 300); },
};

/* ================= PRIMITIVES ================= */
export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="panel-title flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 bg-cyan" />{title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Slider({ label, value, min, max, step, unit, onChange, amber, id }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void; amber?: boolean; id?: string;
}) {
  const highlight = useStore((x) => x.highlight);
  const hot = id && highlight === id;
  return (
    <div className={`mb-2.5 ${hot ? "outline outline-1 outline-amber/80 bg-amber/5 px-1 -mx-1" : ""}`}>
      <div className="flex justify-between items-baseline mb-0.5">
        <span className="lbl">{label}</span>
        <span className="readout text-[11px] text-cyan2">{fmt(value, step < 0.1 ? 2 : step < 1 ? 1 : 0)}{unit && <span className="text-ink3 text-[9px] ml-1">{unit}</span>}</span>
      </div>
      <input type="range" className={`dial ${amber ? "amber" : ""}`} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={label} />
      <div className="tickrow opacity-50 -mt-1" />
    </div>
  );
}

export function Toggle({ label, on, onChange, amber }: { label: string; on: boolean; onChange: (b: boolean) => void; amber?: boolean }) {
  return (
    <button
      onClick={() => { sfx.click(); onChange(!on); }}
      className={`flex items-center gap-2 py-1 w-full text-left group`}
      aria-pressed={on}
    >
      <span className={`w-7 h-3.5 border transition-all ${on ? (amber ? "border-amber bg-amber/25" : "border-cyan bg-cyan/20") : "border-line2 bg-hull"}`}>
        <span className={`block w-2.5 h-2.5 mt-[1px] transition-all ${on ? (amber ? "ml-4 bg-amber" : "ml-4 bg-cyan") : "ml-[1px] bg-ink3"}`} />
      </span>
      <span className={`lbl group-hover:text-ink2 ${on ? (amber ? "!text-amber2" : "!text-cyan2") : ""}`}>{label}</span>
    </button>
  );
}

export function Kv({ k, v, unit, amber }: { k: string; v: string; unit?: string; amber?: boolean }) {
  return (
    <div className="flex justify-between items-baseline py-[3px] border-b border-line/40">
      <span className="lbl">{k}</span>
      <span className={`readout text-[11.5px] ${amber ? "text-amber2" : "text-cyan2"}`}>{v}{unit && <span className="text-ink3 text-[9px] ml-1">{unit}</span>}</span>
    </div>
  );
}

/* ================= GRAPH (real sim data, click = scrub) ================= */
export interface SeriesDef { key: string; label: string; color: string; get: (s: any) => number }
export function SimGraph({ series, height = 92, title }: { series: SeriesDef[]; height?: number; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setTick] = useState(0);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(iv);
  }, []);

  const h = world.history;
  const draw = () => {
    const cv = ref.current; if (!cv) return;
    const W = cv.clientWidth, H = height;
    cv.width = W * 2; cv.height = H * 2;
    const c = cv.getContext("2d")!;
    c.scale(2, 2);
    c.clearRect(0, 0, W, H);
    c.fillStyle = "rgba(6,12,24,0.85)";
    c.fillRect(0, 0, W, H);
    // grid
    c.strokeStyle = "rgba(42,74,115,0.25)";
    c.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, (H / 4) * i); c.lineTo(W, (H / 4) * i); c.stroke(); }
    if (h.length < 2) {
      c.fillStyle = "#54718f"; c.font = "9px 'IBM Plex Mono'";
      c.fillText("AWAITING LAUNCH — NO TELEMETRY", 10, H / 2);
      return;
    }
    const n = h.length;
    series.forEach((sr) => {
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < n; i++) { const v = sr.get(h[i]); if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx - mn < 1e-9) { mx = mn + 1; }
      c.strokeStyle = sr.color;
      c.lineWidth = 1.1;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (W - 46) + 4;
        const y = H - 6 - ((sr.get(h[i]) - mn) / (mx - mn)) * (H - 14);
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
      // live value label
      c.fillStyle = sr.color;
      c.font = "8.5px 'IBM Plex Mono'";
      const last = sr.get(h[n - 1]);
      c.fillText(sr.label, W - 42, 10 + series.indexOf(sr) * 10);
      c.fillText(fmt(last, 2), W - 42, 19 + series.indexOf(sr) * 10);
    });
    // markers
    const drawMarker = (idx: number, col: string) => {
      const x = (idx / (n - 1)) * (W - 46) + 4;
      c.strokeStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, 2); c.lineTo(x, H - 2); c.stroke();
    };
    if (world.scrub != null) drawMarker(world.scrub, "#ffb648");
    else drawMarker(n - 1, "rgba(95,224,255,0.5)");
  };

  useEffect(() => { draw(); });

  const onClick = (e: React.MouseEvent) => {
    if (h.length < 2) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = clamp(Math.round((x / rect.width) * (h.length - 1)), 0, h.length - 1);
    if (useStore.getState().running) useStore.getState().setRunning(false);
    scrubTo(idx);
    setScrubIdx(idx);
    sfx.tick();
  };
  const resume = () => { resumeFromScrub(); useStore.getState().setRunning(true); setScrubIdx(null); sfx.click(); };

  return (
    <div className="relative">
      {title && <div className="lbl mb-1">{title}</div>}
      <canvas ref={ref} style={{ width: "100%", height }} onClick={onClick} className="cursor-crosshair border border-line/60" />
      {scrubIdx != null && (
        <button className="btn amber absolute right-1 top-1 !px-2 !py-1 !text-[8px]" onClick={resume}>RESUME LIVE ▶</button>
      )}
    </div>
  );
}

/* ================= GRAVITY METER DIAL ================= */
export function GravityMeter({ g, label = "SURFACE g" }: { g: number; label?: string }) {
  const max = 30;
  const ang = -110 + clamp(g / max, 0, 1) * 220;
  const ticks = Array.from({ length: 16 }, (_, i) => -110 + (i / 15) * 220);
  return (
    <div className="flex flex-col items-center">
      <svg width="130" height="86" viewBox="0 0 130 86">
        <path d="M 12 78 A 55 55 0 1 1 118 78" fill="none" stroke="#1d3350" strokeWidth="7" />
        <path d="M 12 78 A 55 55 0 1 1 118 78" fill="none" stroke="rgba(95,224,255,0.25)" strokeWidth="1" />
        {ticks.map((a, i) => {
          const r1 = i % 5 === 0 ? 46 : 50, r2 = 54;
          const rad = ((a - 90) * Math.PI) / 180;
          return <line key={i} x1={65 + r1 * Math.cos(rad)} y1={66 + r1 * Math.sin(rad)} x2={65 + r2 * Math.cos(rad)} y2={66 + r2 * Math.sin(rad)} stroke={i % 5 === 0 ? "#5fe0ff" : "#2e7fa3"} strokeWidth={i % 5 === 0 ? 1.4 : 0.7} />;
        })}
        <line x1="65" y1="66" x2={65 + 44 * Math.cos(((ang - 90) * Math.PI) / 180)} y2={66 + 44 * Math.sin(((ang - 90) * Math.PI) / 180)} stroke="#ffb648" strokeWidth="2" style={{ transition: "all 0.6s cubic-bezier(0.2,0.8,0.3,1)" }} />
        <circle cx="65" cy="66" r="4" fill="#ffb648" />
        <text x="65" y="84" textAnchor="middle" fill="#54718f" fontSize="6.5" fontFamily="Michroma" letterSpacing="2">{label}</text>
      </svg>
      <div className="readout text-[15px] text-cyan2 -mt-1">{g.toFixed(4)} <span className="text-[9px] text-ink3">m/s²</span></div>
    </div>
  );
}

/* ================= ANIMATED FIGURES (weight / jump) ================= */
export function WeightFigure({ name, weight, refWeight, color }: { name: string; weight: number; refWeight: number; color: string }) {
  const squash = clamp(weight / Math.max(refWeight, 1), 0.35, 1.9);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="52" height="74" viewBox="0 0 52 74">
        <rect x="6" y="66" width="40" height="5" fill="#1d3350" />
        <line x1="26" y1="66" x2="26" y2="52" stroke="#2e7fa3" strokeWidth="2" strokeDasharray="2 2" />
        <g style={{ transform: `translate(26px, 66px) scale(1, ${1 / Math.sqrt(squash)}) translate(-26px, -66px)`, transformOrigin: "26px 66px", transition: "transform 0.7s cubic-bezier(0.3,1.4,0.4,1)" }}>
          <circle cx="26" cy="18" r="7" fill={color} />
          <line x1="26" y1="25" x2="26" y2="45" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
          <line x1="26" y1="30" x2="15" y2={38 + squash * 3} stroke={color} strokeWidth="2.6" strokeLinecap="round" />
          <line x1="26" y1="30" x2="37" y2={38 + squash * 3} stroke={color} strokeWidth="2.6" strokeLinecap="round" />
          <line x1="26" y1="45" x2="19" y2="63" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
          <line x1="26" y1="45" x2="33" y2="63" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
        </g>
      </svg>
      <div className="lbl">{name}</div>
      <div className="readout text-[11px] text-amber2">{fmt(weight, 1)} N</div>
    </div>
  );
}

export function JumpFigure({ v0, g, color }: { v0: number; g: number; color: string }) {
  const H = (v0 * v0) / (2 * g);
  const T = (2 * v0) / g;
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      const t = ((performance.now() - t0) / 1000) % (T + 0.8);
      if (t < T) setY(Math.max(0, v0 * t - 0.5 * g * t * t));
      else setY(0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [v0, g, T]);
  const pxPerM = 120 / Math.max(H, 0.4);
  return (
    <div className="relative h-[150px] border-l border-b border-line2 ml-6 overflow-hidden" >
      {/* max-height marker */}
      <div className="absolute left-0 right-0 border-t border-dashed border-amber/60" style={{ bottom: 10 + H * pxPerM }}>
        <span className="readout absolute right-1 -top-3.5 text-[8.5px] text-amber2">{fmt(H, 2)} m</span>
      </div>
      {[0.25, 0.5, 0.75].map((f) => (
        <div key={f} className="absolute left-0 w-2 border-t border-line2" style={{ bottom: 10 + H * pxPerM * f }} />
      ))}
      <div ref={ref} className="absolute left-3" style={{ bottom: 10 + y * pxPerM, transition: "none" }}>
        <svg width="26" height="40" viewBox="0 0 26 40">
          <circle cx="13" cy="7" r="5" fill={color} />
          <line x1="13" y1="12" x2="13" y2="26" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
          <line x1="13" y1="16" x2="5" y2={y > 0.02 ? 10 : 22} stroke={color} strokeWidth="2" strokeLinecap="round" />
          <line x1="13" y1="16" x2="21" y2={y > 0.02 ? 10 : 22} stroke={color} strokeWidth="2" strokeLinecap="round" />
          <line x1="13" y1="26" x2="7" y2={y > 0.02 ? 34 : 38} stroke={color} strokeWidth="2.2" strokeLinecap="round" />
          <line x1="13" y1="26" x2="19" y2={y > 0.02 ? 34 : 38} stroke={color} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-0 right-0 readout text-[8.5px] text-ink3 px-1 py-0.5">
        t-flight {fmtTime(T)} · apex {fmt(H, 2)} m · g {fmt(g, 2)}
      </div>
    </div>
  );
}

/* ================= TELEMETRY POLLING HOOK ================= */
export function useTelemetry(ms = 200): Telemetry {
  const [t, setT] = useState<Telemetry>(() => telemetry());
  useEffect(() => {
    const iv = setInterval(() => setT(telemetry()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return t;
}
