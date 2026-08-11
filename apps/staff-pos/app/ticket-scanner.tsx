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
  const pendingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  function stopCamera() {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => stopCamera, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!credential.trim() || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      let deviceId = window.localStorage.getItem("attend-scanner-device-id");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        window.localStorage.setItem("attend-scanner-device-id", deviceId);
      }
      setResult(await apiFetch<TicketScanResponse>("/ticketing/scans", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          credential: credential.trim(),
          expectedShowtimeId,
          deviceId,
          entrance: entrance.trim() || undefined,
        }),
      }));
      setCredential("");
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.body.message : "Ticket could not be checked.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function startCamera() {
    const Detector = (window as unknown as {
      BarcodeDetector?: new (options: { formats: string[] }) => {
        detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
      };
    }).BarcodeDetector;
    if (!Detector) {
      setMessage("Camera QR scanning is not supported in this browser. Paste the credential below.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopCamera();
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      const detector = new Detector({ formats: ["qr_code"] });
      setMessage("Camera active—point it at the ticket.");
      intervalRef.current = window.setInterval(async () => {
        const found = await detector.detect(video);
        if (found[0]?.rawValue) {
          stopCamera();
          setCredential(found[0].rawValue);
          setMessage("QR captured. Press Check ticket.");
        }
      }, 350);
      timeoutRef.current = window.setTimeout(() => {
        stopCamera();
      }, 30_000);
    } catch {
      setMessage("Camera access was unavailable. Paste the credential below.");
    }
  }

  return (
    <section className="scanner-panel">
      <h2>Ticket scanner</h2>
      <video ref={videoRef} className="scanner-preview" muted playsInline aria-label="Ticket scanner camera preview" />
      <button type="button" onClick={startCamera}>Start camera</button>
      <p>{message}</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>QR credential</span>
          <input value={credential} onChange={(event) => setCredential(event.target.value)} />
        </label>
        <label className="field">
          <span>Entrance (optional)</span>
          <input value={entrance} onChange={(event) => setEntrance(event.target.value)} placeholder="Main entrance" />
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
