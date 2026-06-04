import { useRef } from "react";
import { attachCaptureRuntime } from "../runtime/captureRuntime";

export function CaptureRuntimeHost() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  return <div className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0" aria-hidden="true">
    <video ref={videoRef} muted playsInline className="h-px w-px" />
    <canvas
      ref={(node) => {
        attachCaptureRuntime(videoRef.current, node);
      }}
      className="h-px w-px"
    />
  </div>;
}
