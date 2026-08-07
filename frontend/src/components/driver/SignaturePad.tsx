"use client";

import { useEffect, useRef, useState } from "react";
import { FiCheck, FiRefreshCw } from "react-icons/fi";

export default function SignaturePad({ disabled, onSave }: { disabled?: boolean; onSave: (blob: Blob) => Promise<void> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    setHasInk(false);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.getBoundingClientRect().width;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(180 * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.5;
    context.strokeStyle = "#0f172a";
    context.fillStyle = "white";
    context.fillRect(0, 0, width, 180);
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    const current = point(event);
    context?.beginPath();
    context?.moveTo(current.x, current.y);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    const context = event.currentTarget.getContext("2d");
    const current = point(event);
    context?.lineTo(current.x, current.y);
    context?.stroke();
    setHasInk(true);
  }

  function stop() { drawingRef.current = false; }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Signature could not be prepared.")), "image/png"));
      await onSave(blob);
    } finally { setSaving(false); }
  }

  return <div>
    <canvas
      ref={canvasRef}
      aria-label="Customer signature pad"
      onPointerDown={start}
      onPointerMove={draw}
      onPointerUp={stop}
      onPointerCancel={stop}
      className="h-[180px] w-full touch-none rounded-2xl border border-slate-300 bg-white"
    />
    <p className="mt-2 text-xs text-slate-500">Ask the pickup contact to sign inside the box.</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" disabled={disabled || saving} onClick={clear} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold"><FiRefreshCw />Clear</button>
      <button type="button" disabled={disabled || saving || !hasInk} onClick={() => void save()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1282] text-sm font-semibold text-white disabled:bg-slate-300"><FiCheck />{saving ? "Saving..." : "Save signature"}</button>
    </div>
  </div>;
}
