import { useCallback, useEffect, useRef, useState } from "react";
import {
  getUltralyticsTrainingStatus,
  startUltralyticsTraining,
  stopUltralyticsTraining,
} from "../api/client";

export type UltralyticsTrainingJobView = {
  id?: string;
  state?: string;
  elapsedMs?: number;
  pid?: number | null;
  error?: string | null;
  stuckReason?: string | null;
  trainingScope?: string;
  runtime?: string;
  trainingPython?: string;
  artifactPaths?: { weights?: string };
  stagedWorkspace?: string | null;
  runPath?: string | null;
  wsl?: { linuxPids?: number[] };
  processAlive?: boolean;
};

const ACTIVE_STATES = new Set([
  "starting",
  "training",
  "validating",
  "exporting",
  "mirroring",
  "cleanup",
  "stuck",
]);

export function ultralyticsTrainingJobIsActive(state: string | undefined) {
  return Boolean(state && ACTIVE_STATES.has(state));
}

export function useUltralyticsTrainingJob(handlers?: {
  onMessage?: (message: string) => void;
  onCompleted?: () => void | Promise<void>;
  busyKeys?: string[];
}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [trainingJob, setTrainingJob] = useState<UltralyticsTrainingJobView | null>(null);
  const [starting, setStarting] = useState(false);

  const trainingActive = Boolean(
    trainingJob &&
      !["idle", "completed", "failed", "killed"].includes(String(trainingJob.state ?? "")),
  );
  const trainingBusy = trainingActive || starting;

  const refreshTrainingJob = useCallback(async () => {
    try {
      const response = await getUltralyticsTrainingStatus();
      const job = (response.data ?? response) as UltralyticsTrainingJobView;
      setTrainingJob(job);
      if (job.state === "completed") {
        setStarting(false);
        handlersRef.current?.onMessage?.("Training completed. Export ONNX when ready for DirectML inference.");
        await handlersRef.current?.onCompleted?.();
      } else if (job.state === "failed" || job.state === "killed") {
        setStarting(false);
        handlersRef.current?.onMessage?.(job.error ?? `Training ${job.state}.`);
      } else if (job.state === "stuck") {
        setStarting(false);
        handlersRef.current?.onMessage?.(
          job.stuckReason ?? "Training is stuck with artifacts present. Stop the process to release the GPU.",
        );
      } else if (ultralyticsTrainingJobIsActive(job.state) && job.state !== "stuck") {
        const minutes = Math.floor(Number(job.elapsedMs ?? 0) / 60000);
        const seconds = Math.floor((Number(job.elapsedMs ?? 0) % 60000) / 1000);
        handlersRef.current?.onMessage?.(
          `Training ${job.state} (${minutes}:${String(seconds).padStart(2, "0")}) · PID ${job.pid ?? "-"} · scope ${job.trainingScope ?? "-"}`,
        );
      }
      return job;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshTrainingJob();
  }, [refreshTrainingJob]);

  useEffect(() => {
    if (!trainingActive) return;
    const timer = window.setInterval(() => {
      void refreshTrainingJob();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [trainingActive, trainingJob?.id, trainingJob?.state, refreshTrainingJob]);

  async function startTraining(trainOptions: Record<string, unknown> = {}) {
    if (trainingBusy) {
      throw new Error("A training job is already running.");
    }
    setStarting(true);
    try {
      const response = await startUltralyticsTraining(trainOptions);
      const job = (response.data ?? response) as UltralyticsTrainingJobView;
      setTrainingJob(job);
      await refreshTrainingJob();
      return job;
    } catch (error) {
      setStarting(false);
      throw error;
    }
  }

  async function stopTraining() {
    const response = await stopUltralyticsTraining();
    const job = (response.data ?? response) as UltralyticsTrainingJobView;
    setTrainingJob(job);
    setStarting(false);
    handlersRef.current?.onMessage?.("Training stop requested. GPU workers should exit shortly.");
    await refreshTrainingJob();
    return job;
  }

  function isTrainingBusyKey(busy: string) {
    const keys = handlers?.busyKeys ?? ["train", "quick-train", "full-train"];
    return trainingBusy || keys.includes(busy);
  }

  return {
    trainingJob,
    trainingActive,
    trainingBusy,
    starting,
    refreshTrainingJob,
    startTraining,
    stopTraining,
    isTrainingBusyKey,
  };
}
