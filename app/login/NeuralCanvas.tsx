"use client";

import { useEffect, useRef } from "react";

// A drifting neural mesh: nodes link when close, and signal pulses travel along links between them.
// Colours come from the active theme, so the canvas follows the theme picker. Reduced motion draws one still frame.
export default function NeuralCanvas({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const colors = ["--secondary", "--tertiary", "--primary"].map((v) => css.getPropertyValue(v).trim() || "#f04f70");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const LINK = 150;
    type Node = { x: number; y: number; vx: number; vy: number; r: number; c: string };
    type Pulse = { a: Node; b: Node; t: number; c: string };
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    const mouse = { x: -1e4, y: -1e4 };

    function resize() {
      const dpr = Math.min(devicePixelRatio, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(110, (w * h) / 9000));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.8,
        c: colors[Math.floor(Math.random() * colors.length)],
      }));
      pulses = [];
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const p of nodes) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        // nodes lean gently toward the pointer
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 180) {
          p.x += dx * 0.004;
          p.y += dy * 0.004;
        }
      }
      // ponytail: O(n²) link scan; fine at ≤110 nodes, use a grid if the count grows
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > LINK) continue;
          ctx.globalAlpha = (1 - d / LINK) * 0.35;
          ctx.strokeStyle = a.c;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          if (!still && pulses.length < 24 && Math.random() < 0.0009) pulses.push({ a, b, t: 0, c: a.c });
        }
      }
      ctx.globalAlpha = 1;
      for (const p of nodes) {
        ctx.fillStyle = p.c;
        ctx.shadowColor = p.c;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      pulses = pulses.filter((s) => (s.t += 0.018) < 1 && Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y) < LINK);
      for (const s of pulses) {
        ctx.fillStyle = "#fff";
        ctx.shadowColor = s.c;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(s.a.x + (s.b.x - s.a.x) * s.t, s.a.y + (s.b.y - s.a.y) * s.t, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (!still) raf = requestAnimationFrame(frame);
    }

    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const leave = () => (mouse.x = mouse.y = -1e4);
    const ro = new ResizeObserver(() => {
      resize();
      if (still) frame();
    });
    ro.observe(canvas);
    addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    if (!still) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
