"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { TicketScanResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

export function TicketScanner({
  accessToken,
  expectedShowtimeId,
}: {
  accessToken: string;
  expectedShowtimeId: string;
}) {
  const [credential, setCredential] = useState("");
  const [result, setResult] = useState<TicketScanResponse | null>(null);
  const [message, setMessage] = useState("Use the camera or paste a QR credential.");
  const [entrance, setEntrance] = useState("");
  const [pending, setPending] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const pendingRef = useRef(false);
  const scanRequestRef = useRef(0);
  const cameraStartingRef = useRef(false);
  const cameraSessionRef = useRef(0);
  const detectingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  function stopCamera() {
    cameraSessionRef.current += 1;
    detectingRef.current = false;
    cameraStartingRef.current = false;
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraStarting(false);
    setCameraActive(false);
  }

  useEffect(() => stopCamera, []);

  useEffect(() => {
    scanRequestRef.current += 1;
    pendingRef.current = false;
    setPending(false);
    setResult(null);
    stopCamera();
    setMessage("Use the camera or paste a QR credential.");
  }, [expectedShowtimeId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const requestedCredential = credential.trim();
    const requestedEntrance = entrance.trim();
    if (!requestedCredential || pendingRef.current) return;
    if (requestedCredential.length > 2048) {
      setMessage("QR credentials cannot exceed 2,048 characters.");
      return;
    }
    if (requestedEntrance.length > 120) {
      setMessage("Entrance names cannot exceed 120 characters.");
      return;
    }
    stopCamera();
    pendingRef.current = true;
    const requestId = ++scanRequestRef.current;
    setPending(true);
    setResult(null);
    setMessage("Checking ticket…");
    try {
      let deviceId = window.localStorage.getItem("attend-scanner-device-id");
      if (!deviceId?.trim() || deviceId.length > 120) {
        deviceId = crypto.randomUUID();
        window.localStorage.setItem("attend-scanner-device-id", deviceId);
      }
      const response = await apiFetch<TicketScanResponse>("/ticketing/scans", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          credential: requestedCredential,
          expectedShowtimeId,
          deviceId,
          entrance: requestedEntrance || undefined,
        }),
      });
      if (requestId !== scanRequestRef.current) return;
      setResult(response);
      setMessage("Ticket checked.");
      setCredential("");
    } catch (error) {
      if (requestId !== scanRequestRef.current) return;
      setMessage(error instanceof ApiRequestError ? error.body.message : "Ticket could not be checked.");
    } finally {
      if (requestId === scanRequestRef.current) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  async function startCamera() {
    if (pendingRef.current || cameraStartingRef.current || streamRef.current) return;
    const Detector = (window as unknown as {
      BarcodeDetector?: new (options: { formats: string[] }) => {
        detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
      };
    }).BarcodeDetector;
    if (!Detector) {
      setMessage("Camera QR scanning is not supported in this browser. Paste the credential below.");
      return;
    }
    cameraStartingRef.current = true;
    setCameraStarting(true);
    setResult(null);
    setMessage("Starting camera…");
    const cameraSession = cameraSessionRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (cameraSession !== cameraSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraActive(true);
      video.srcObject = stream;
      await video.play();
      if (cameraSession !== cameraSessionRef.current) return;
      const detector = new Detector({ formats: ["qr_code"] });
      setMessage("Camera active—point it at the ticket.");
      intervalRef.current = window.setInterval(async () => {
        if (detectingRef.current || cameraSession !== cameraSessionRef.current) return;
        detectingRef.current = true;
        try {
          const found = await detector.detect(video);
          if (cameraSession !== cameraSessionRef.current) return;
          if (found[0]?.rawValue) {
            stopCamera();
            setCredential(found[0].rawValue);
            setMessage("QR captured. Press Check ticket.");
          }
        } catch {
          if (cameraSession !== cameraSessionRef.current) return;
          stopCamera();
          setMessage("Camera scanning stopped unexpectedly. Paste the credential below or try again.");
        } finally {
          if (cameraSession === cameraSessionRef.current) detectingRef.current = false;
        }
      }, 350);
      timeoutRef.current = window.setTimeout(() => {
        stopCamera();
      }, 30_000);
    } catch {
      if (cameraSession !== cameraSessionRef.current) return;
      setMessage("Camera access was unavailable. Paste the credential below.");
    } finally {
      if (cameraSession === cameraSessionRef.current) {
        cameraStartingRef.current = false;
        setCameraStarting(false);
      }
    }
  }

  return (
    <section className="scanner-panel">
      <h2>Ticket scanner</h2>
      <video ref={videoRef} className="scanner-preview" muted playsInline aria-label="Ticket scanner camera preview" />
      <button type="button" onClick={startCamera} disabled={pending || cameraStarting || cameraActive}>
        {cameraStarting ? "Starting camera…" : cameraActive ? "Camera active" : "Start camera"}
      </button>
      <p>{message}</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>QR credential</span>
          <input value={credential} maxLength={2048} disabled={pending} onChange={(event) => {
            setCredential(event.target.value);
            setResult(null);
          }} />
        </label>
        <label className="field">
          <span>Entrance (optional)</span>
          <input value={entrance} maxLength={120} disabled={pending} onChange={(event) => setEntrance(event.target.value)} placeholder="Main entrance" />
        </label>
        <button className="primary" disabled={pending || !credential.trim()}>
          {pending ? "Checking…" : "Check ticket"}
        </button>
      </form>
      {result && (
        <div className={`scan-result ${result.result.toLowerCase()}`} role="status">
          <strong>{result.result === "VALID" ? "ADMIT" : result.result.replaceAll("_", " ")}</strong>
          {result.ticket && <p>{result.ticket.movie} · {result.ticket.auditorium} · Seat {result.ticket.seat}</p>}
        </div>
      )}
    </section>
  );
}
