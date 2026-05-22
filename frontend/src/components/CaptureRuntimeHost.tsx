import { useEffect, useRef } from "react";
import { attachCaptureRuntime } from "../runtime/captureRuntime";

export function CaptureRuntimeHost() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    attachCaptureRuntime(videoRef.current, canvasRef.current);
    return () => attachCaptureRuntime(null, null);
  }, []);

  return <div className="hidden" aria-hidden="true">
    <video ref={videoRef} muted playsInline />
    <canvas ref={canvasRef} />
  </div>;
}
