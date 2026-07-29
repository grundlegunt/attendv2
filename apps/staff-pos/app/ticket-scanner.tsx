"use client";

import { FormEvent, useState } from "react";
import type { TicketScanResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

export function TicketScanner({
  accessToken,
  expectedShowtimeId,
}: {
  accessToken: string;
  expectedShowtimeId?: string;
}) {
  const [credential, setCredential] = useState("");
  const [result, setResult] = useState<TicketScanResponse | null>(null);
  const [message, setMessage] = useState("Use the camera or paste a QR credential.");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!credential.trim()) return;
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
        body: JSON.stringify({ credential: credential.trim(), expectedShowtimeId, deviceId }),
      }));
      setCredential("");
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.body.message : "Ticket could not be checked.");
    } finally {
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
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
      const detector = new Detector({ formats: ["qr_code"] });
      setMessage("Camera active—point it at the ticket.");
      const timer = window.setInterval(async () => {
        const found = await detector.detect(video);
        if (found[0]?.rawValue) {
          window.clearInterval(timer);
          stream.getTracks().forEach((track) => track.stop());
          setCredential(found[0].rawValue);
          setMessage("QR captured. Press Check ticket.");
        }
      }, 350);
      window.setTimeout(() => {
        window.clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
      }, 30_000);
    } catch {
      setMessage("Camera access was unavailable. Paste the credential below.");
    }
  }

  return (
    <section className="scanner-panel">
      <h2>Ticket scanner</h2>
      <button type="button" onClick={startCamera}>Start camera</button>
      <p>{message}</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>QR credential</span>
          <input value={credential} onChange={(event) => setCredential(event.target.value)} />
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
