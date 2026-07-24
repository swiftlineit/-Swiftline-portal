"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { FiCamera, FiCheckCircle, FiLogOut, FiRefreshCw, FiZap, FiZapOff, FiXCircle } from "react-icons/fi";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import {
  disconnectOperationsScanSession,
  getOperationsScanSession,
  scanOperationsParcel,
  type ManifestDetail,
  type OperationsScanSession
} from "@/lib/operationsManifests";

type ScanResult = {
  accepted: boolean;
  code: string;
  message: string;
  detail?: ManifestDetail;
};

// `focusMode` and `torch` are camera capabilities the DOM typings do not model yet.
type CameraConstraintSet = MediaTrackConstraintSet & { focusMode?: string; torch?: boolean };

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

// Consignment parties are stored as a single formatted block: company on the first
// line, then contact and address. The phone shows the name and address separately.
function partyLines(snapshot?: { name?: string; formatted?: string }) {
  const lines = (snapshot?.formatted ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const explicitName = snapshot?.name?.trim() ?? "";
  return {
    name: explicitName || lines[0] || "Not available",
    address: (explicitName ? lines : lines.slice(1)).join(", ")
  };
}

async function createNativeBarcodeDetector() {
  const detectorConstructor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!detectorConstructor) return null;
  try {
    const supported = await detectorConstructor.getSupportedFormats?.() ?? [];
    if (!supported.includes("code_128")) return null;
    return new detectorConstructor({ formats: ["code_128"] });
  } catch {
    return null;
  }
}

function feedbackTone(accepted: boolean) {
  try {
    const AudioContextType = window.AudioContext;
    const context = new AudioContextType();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = accepted ? 880 : 220;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (accepted ? 0.12 : 0.3));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (accepted ? 0.12 : 0.3));
    oscillator.onended = () => void context.close();
  } catch {
    // Sound feedback is optional on browsers that block Web Audio.
  }
  navigator.vibrate?.(accepted ? 80 : [120, 80, 120]);
}

export default function ManifestPhoneScannerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeLoopRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef<OperationsScanSession | null>(null);
  const recentCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [session, setSession] = useState<OperationsScanSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  const loadSession = useCallback(async () => {
    const token = getAccessToken() ?? await refreshAccessToken();
    if (!token) {
      router.replace(`/?next=${encodeURIComponent(`/manifest-scanner/${sessionId}`)}`);
      return null;
    }
    try {
      const response = await getOperationsScanSession(sessionId);
      sessionRef.current = response.session;
      setSession(response.session);
      if (response.session.status === "ENDED") {
        controlsRef.current?.stop();
        setCameraRunning(false);
      }
      return response.session;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Scanner session could not be loaded.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [router, sessionId]);

  useEffect(() => {
    void Promise.resolve().then(loadSession);
    const interval = window.setInterval(() => { if (!document.hidden) void loadSession(); }, 2500);
    return () => {
      window.clearInterval(interval);
      controlsRef.current?.stop();
    };
  }, [loadSession]);

  const submitCode = useCallback(async (rawCode: string, scanSource: "CAMERA" | "MANUAL" = "CAMERA") => {
    const code = rawCode.trim().toUpperCase();
    const currentSession = sessionRef.current;
    if (!code || !currentSession?.activeBag || currentSession.status !== "ACTIVE" || busyRef.current) return;
    const now = Date.now();
    if (recentCodeRef.current.code === code && now - recentCodeRef.current.at < 3000) return;
    recentCodeRef.current = { code, at: now };
    busyRef.current = true;
    setError("");
    try {
      const activeBagId = currentSession.activeBag.id;
      const detail = await scanOperationsParcel(
        currentSession.manifestId,
        activeBagId,
        code,
        crypto.randomUUID(),
        { scanSource, sessionId }
      );
      setResult({ accepted: true, code, message: detail.latestScan?.message || "Parcel added.", detail });
      setManualCode("");
      feedbackTone(true);

      // Follow the bag the parcel actually landed in. A full bag opens a new one
      // server-side, and reusing the previously active bag here would send the next
      // parcel back to the old bag and split shipments that belong together.
      const packedBagId = detail.latestScan?.bagId ?? activeBagId;
      const scannedBag = detail.bags.find((bag) => bag.id === packedBagId);
      if (scannedBag) {
        const nextSession = {
          ...currentSession,
          activeBag: {
            id: scannedBag.id,
            bagNumber: scannedBag.bagNumber,
            status: scannedBag.status,
            totalPhysicalParcels: scannedBag.totalPhysicalParcels,
            totalWeightKg: scannedBag.totalWeightKg
          }
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "This parcel could not be scanned.";
      setResult({ accepted: false, code, message });
      feedbackTone(false);
      void loadSession();
    } finally {
      window.setTimeout(() => { busyRef.current = false; }, 250);
    }
  }, [loadSession, sessionId]);

  async function startCamera() {
    const video = videoRef.current;
    if (!video || cameraRunning) return;
    setError("");
    try {
      // Code 128 needs horizontal pixels far more than it needs frame rate, so the
      // stream is requested at the highest width the phone will grant.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" } as CameraConstraintSet]
        }
      });
      streamRef.current = stream;

      const detector = await createNativeBarcodeDetector();
      if (detector) {
        // Chrome on Android decodes in native code, which is several times faster
        // than the JavaScript decoder and far more tolerant of a moving phone.
        video.srcObject = stream;
        await video.play();
        const readFrame = async () => {
          if (!streamRef.current) return;
          try {
            const [found] = await detector.detect(video);
            if (found?.rawValue) void submitCode(found.rawValue, "CAMERA");
          } catch {
            // A dropped frame is not an error worth surfacing; the next one retries.
          }
          nativeLoopRef.current = window.setTimeout(() => void readFrame(), 100);
        };
        void readFrame();
      } else {
        const reader = new BrowserMultiFormatReader(new Map(), { delayBetweenScanAttempts: 50, delayBetweenScanSuccess: 300 });
        // The hints map must exist before this setter runs, otherwise the reader
        // keeps trying every symbology and decoding stays slow.
        reader.possibleFormats = [BarcodeFormat.CODE_128];
        controlsRef.current = await reader.decodeFromStream(stream, video, (decoded) => {
          if (decoded) void submitCode(decoded.getText(), "CAMERA");
        });
      }

      setCameraRunning(true);
    } catch (caughtError) {
      stopCamera();
      setError(caughtError instanceof Error ? caughtError.message : "Camera access was denied. Use manual entry below.");
    }
  }

  function stopCamera() {
    if (nativeLoopRef.current !== null) {
      window.clearTimeout(nativeLoopRef.current);
      nativeLoopRef.current = null;
    }
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraRunning(false);
    setTorchOn(false);
  }

  async function toggleTorch() {
    const next = !torchOn;
    const track = streamRef.current?.getVideoTracks()[0];
    try {
      // Torch is a Chromium-on-Android capability. iOS Safari has no equivalent.
      if (!track) throw new Error("Start the camera before using the torch.");
      await track.applyConstraints({ advanced: [{ torch: next } as CameraConstraintSet] });
      setTorchOn(next);
    } catch {
      setError("Torch control is not available on this phone.");
    }
  }

  async function disconnect() {
    if (session?.manifestId) await disconnectOperationsScanSession(session.manifestId, sessionId).catch(() => undefined);
    stopCamera();
    router.replace("/");
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    void submitCode(manualCode, "MANUAL");
  }

  const latestConsignment = result?.detail?.consignments.find((item) => item.scannedParcelNumbers.includes(result.code));
  const consignee = latestConsignment ? partyLines(latestConsignment.consigneeSnapshot) : null;

  return (
    <main className="min-h-screen bg-slate-950 px-3 pb-4 text-white">
      <header className="sticky top-0 z-10 -mx-3 mb-3 flex min-h-16 items-center justify-between bg-[#0D1282] px-4 py-3 shadow-lg">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/Slogo.png" alt="Swiftline" width={36} height={36} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{session?.manifest?.manifestNumber ?? "Manifest Scanner"}</p>
            <p className="truncate text-xs text-white/70">{session?.activeBag?.bagNumber ?? "Waiting for an open bag"}</p>
          </div>
        </div>
        <button onClick={() => void disconnect()} title="Disconnect phone" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"><FiLogOut /></button>
      </header>

      {/* A Code 128 label is wide and short, so a letterbox viewport frames it without
          pushing the scan result off screen. */}
      <section className="relative h-[30vh] max-h-64 min-h-40 w-full overflow-hidden rounded-2xl bg-black shadow-lg ring-1 ring-white/10">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-5 top-1/2 h-20 -translate-y-1/2 rounded-xl border-2 border-[#F0DE36] shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
        <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] font-medium text-white/80">
          Hold the barcode inside the frame
        </span>
        {!cameraRunning ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-slate-950/92 p-5 text-center">
            <FiCamera className="h-8 w-8 text-[#F0DE36]" />
            <p className="mt-3 text-xs text-white/80">
              {loading ? "Loading scanner..." : session?.activeBag ? "Scan the printed Swiftline parcel barcode." : "Select an open bag on the laptop before scanning."}
            </p>
            <button
              onClick={() => void startCamera()}
              disabled={loading || !session?.activeBag || session.status !== "ACTIVE"}
              className="mt-4 h-11 rounded-full bg-[#F0DE36] px-6 text-sm font-semibold text-[#0D1282] transition active:scale-95 disabled:opacity-40"
            >
              Start Camera
            </button>
          </div>
        ) : null}
      </section>

      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <button onClick={cameraRunning ? stopCamera : () => void startCamera()} className="flex h-11 items-center justify-center gap-2 rounded-full bg-white/10 text-sm font-semibold transition active:scale-95">
            {cameraRunning ? <FiXCircle /> : <FiCamera />}{cameraRunning ? "Stop" : "Camera"}
          </button>
          <button onClick={() => void toggleTorch()} disabled={!cameraRunning} className="flex h-11 items-center justify-center gap-2 rounded-full bg-white/10 text-sm font-semibold transition active:scale-95 disabled:opacity-40">
            {torchOn ? <FiZapOff /> : <FiZap />}{torchOn ? "Torch" : "Torch"}
          </button>
          <button onClick={() => void loadSession()} className="flex h-11 items-center justify-center gap-2 rounded-full bg-white/10 text-sm font-semibold transition active:scale-95"><FiRefreshCw />Sync</button>
        </div>

        {result ? (
          <div className={`rounded-2xl p-4 ring-2 ${result.accepted ? "bg-emerald-950 ring-emerald-400" : "bg-red-950 ring-red-400"}`}>
            <div className="flex items-start gap-3">
              {result.accepted ? <FiCheckCircle className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" /> : <FiXCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-300" />}
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold">{result.code}</p>
                <p className="mt-1 text-sm">{result.message}</p>
                {latestConsignment && consignee ? (
                  <div className="mt-3 space-y-2 text-xs text-white/80">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span>Consignment</span><strong className="text-right text-white">{latestConsignment.displayConsignmentNumber}</strong>
                      <span>Parcels</span><strong className="text-right text-white">{latestConsignment.scannedParcelNumbers.length} of {latestConsignment.expectedParcelNumbers.length}</strong>
                      <span>Weight</span><strong className="text-right text-white">{latestConsignment.weightKg.toFixed(3)} kg</strong>
                      <span>Service</span><strong className="text-right text-white">{latestConsignment.serviceInfo || "Not set"}</strong>
                    </div>
                    <div className="border-t border-white/20 pt-2">
                      <p className="text-white/60">Consignee</p>
                      <p className="mt-0.5 font-semibold text-white">{consignee.name}</p>
                      {consignee.address ? <p className="mt-0.5 text-white/80">{consignee.address}</p> : null}
                    </div>
                    {latestConsignment.description ? (
                      <div className="border-t border-white/20 pt-2">
                        <p className="text-white/60">Contents</p>
                        <p className="mt-0.5 text-white/90">{latestConsignment.description}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <div className="rounded-2xl bg-amber-950 p-3 text-sm text-amber-100 ring-1 ring-amber-400/50">{error}</div> : null}

        <div className="rounded-2xl bg-white/10 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/70">{session?.activeBag?.bagNumber ?? "No active bag"}</span>
            <strong>{session?.activeBag ? `${session.activeBag.totalWeightKg.toFixed(3)} / 31.000 kg` : "--"}</strong>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-[#F0DE36] transition-all"
              style={{ width: `${Math.min(100, ((session?.activeBag?.totalWeightKg ?? 0) / 31) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-white/60">A full bag opens the next one automatically.</p>
        </div>

        <form onSubmit={submitManual} className="flex gap-2">
          <input value={manualCode} onChange={(event) => setManualCode(event.target.value.toUpperCase())} placeholder="Manual parcel code" className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 font-mono text-sm text-slate-950 outline-none ring-1 ring-white/20" />
          <button disabled={!manualCode.trim() || !session?.activeBag} className="h-11 rounded-full bg-white px-5 text-sm font-semibold text-[#0D1282] transition active:scale-95 disabled:opacity-40">Submit</button>
        </form>
      </div>
    </main>
  );
}
