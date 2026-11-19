import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface CelebrationHandle { fire: (x?: number, y?: number) => void }

interface Petal {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; size: number; hue: string;
  life: number; ttl: number; sway: number; phase: number; kind: number;
}

/** 原创「落英」庆祝特效：自绘花瓣/叶片粒子（重力+摆动+旋转+淡出），
 *  不依赖任何第三方 confetti 代码；尊重 prefers-reduced-motion。 */
export const CelebrationLayer = forwardRef<CelebrationHandle, { className?: string }>(function CelebrationLayer({ className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const petals = useRef<Petal[]>([]);
  const raf = useRef(0);
  const running = useRef(false);

  const palette = () => {
    const cs = getComputedStyle(document.documentElement);
    const pick = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    return [
      pick("--am-accent", "#42b983"),
      pick("--am-info", "#0969da"),
      pick("--am-warning", "#9a6700"),
      pick("--am-danger", "#cf222e"),
      "#e8b4d8",
      "#f2d49b",
    ];
  };

  const loop = () => {
    const canvas = canvasRef.current;
    if (!canvas) { running.current = false; return; }
    const ctx = canvas.getContext("2d");
    if (!ctx) { running.current = false; return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const list = petals.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += 1;
      p.vy += 0.05;            // gravity
      p.vx *= 0.985;           // drag
      p.vy *= 0.995;
      p.phase += 0.06;
      p.x += p.vx + Math.sin(p.phase) * p.sway;
      p.y += p.vy;
      p.rot += p.vr;
      const t = p.life / p.ttl;
      if (t >= 1 || p.y > h + 40) { list.splice(i, 1); continue; }
      const alpha = t < 0.1 ? t / 0.1 : 1 - Math.max(0, (t - 0.7) / 0.3);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = p.hue;
      ctx.beginPath();
      if (p.kind === 0) {
        // petal: teardrop
        ctx.moveTo(0, -p.size);
        ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.4, p.size * 0.7, p.size * 0.6, 0, p.size);
        ctx.bezierCurveTo(-p.size * 0.7, p.size * 0.6, -p.size * 0.9, -p.size * 0.4, 0, -p.size);
      } else if (p.kind === 1) {
        // leaf: pointed ellipse with midrib
        ctx.ellipse(0, 0, p.size * 0.45, p.size, 0, 0, Math.PI * 2);
      } else {
        // spark: small quad
        ctx.rect(-p.size * 0.35, -p.size * 0.35, p.size * 0.7, p.size * 0.7);
      }
      ctx.fill();
      if (p.kind === 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(0, p.size); ctx.stroke();
      }
      ctx.restore();
    }
    if (list.length) raf.current = requestAnimationFrame(loop);
    else { running.current = false; ctx.clearRect(0, 0, w, h); }
  };

  const fire = (x?: number, y?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = canvas.getBoundingClientRect();
    const cx = x != null ? x - rect.left : rect.width / 2;
    const cy = y != null ? y - rect.top : rect.height * 0.35;
    const colors = palette();
    const n = 90;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      petals.current.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 2.5,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.22,
        size: 4 + Math.random() * 7,
        hue: colors[i % colors.length],
        life: 0,
        ttl: 110 + Math.random() * 70,
        sway: 0.4 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        kind: i % 3,
      });
    }
    if (petals.current.length > 600) petals.current.splice(0, petals.current.length - 600);
    if (!running.current) { running.current = true; raf.current = requestAnimationFrame(loop); }
  };

  useImperativeHandle(ref, () => ({ fire }), []);

  useEffect(() => () => { cancelAnimationFrame(raf.current); running.current = false; petals.current = []; }, []);

  return <canvas ref={canvasRef} className={className ?? "pointer-events-none absolute inset-0 h-full w-full"} aria-hidden="true" />;
});