"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { FiCamera, FiStopCircle } from "react-icons/fi";

export default function ParcelScanner({ disabled, onScan }: { disabled?: boolean; onScan: (value: string) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanRef = useRef({ value: "", at: 0 });
  const [manual, setManual] = useState("");
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState("");

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera(false);
  }

  useEffect(() => stopCamera, []);

  async function submit(raw: string) {
    const value = raw.trim().toUpperCase();
    if (!value) return;
    const now = Date.now();
    if (lastScanRef.current.value === value && now - lastScanRef.current.at < 2500) return;
    lastScanRef.current = { value, at: now };
    await onScan(value);
    setManual("");
  }

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      const reader = new BrowserMultiFormatReader(new Map(), { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 500 });
      reader.possibleFormats = [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE];
      controlsRef.current = await reader.decodeFromStream(stream, video, (result) => { if (result) void submit(result.getText()); });
      setCamera(true);
    } catch (caught) {
      stopCamera();
      setError(caught instanceof Error ? caught.message : "Camera permission was denied. Use manual entry.");
    }
  }

  function submitManual(event: FormEvent) { event.preventDefault(); void submit(manual); }

  return <div className="space-y-3">
    <div className={camera ? "overflow-hidden rounded-2xl bg-slate-950" : "hidden"}><video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" /></div>
    {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700">{error}</p> : null}
    <button type="button" disabled={disabled} onClick={() => camera ? stopCamera() : void startCamera()} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#0D1282] text-sm font-semibold text-[#0D1282]">
      {camera ? <><FiStopCircle />Stop camera</> : <><FiCamera />Scan with phone camera</>}
    </button>
    <form onSubmit={submitManual} className="flex gap-2"><input disabled={disabled} value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Enter parcel number" autoCapitalize="characters" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-base uppercase" /><button disabled={disabled || !manual.trim()} className="h-12 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">Add</button></form>
  </div>;
}
