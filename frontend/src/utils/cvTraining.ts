export type CvTrainingDevice = {
  selected?: string;
  type?: string;
  name?: string | null;
  torchVersion?: string | null;
  warning?: string;
};

export const cpuTrainingDisabledMessage =
  "PyTorch CPU training is disabled. Configure CUDA or WSL ROCm training first.";

export function cvTrainingDevice(model: any): CvTrainingDevice | null {
  return model?.trainingDevice ?? model?.device ?? null;
}

export function cpuTrainingBlocked(model: any) {
  const device = cvTrainingDevice(model);
  return Boolean(device && (normalize(device.type) === "cpu" || normalize(device.selected) === "cpu"));
}

export function trainingUnavailable(model: any) {
  const device = cvTrainingDevice(model);
  const type = normalize(device?.type);
  return Boolean(device && (type === "unavailable" || normalize(device.selected) === "unavailable" || type === "directml"));
}

export function trainingDeviceLabel(model: any) {
  const device = cvTrainingDevice(model);
  const type = normalize(device?.type);
  if (!device) return "Unknown";
  if (cpuTrainingBlocked(model)) return "Blocked";
  if (trainingUnavailable(model)) return "Unavailable";
  if (type === "cuda") return "CUDA training";
  if (type === "rocm") return "ROCm training";
  if (type === "mps") return "MPS training";
  return `${String(device.type ?? device.selected ?? "GPU").toUpperCase()} training`;
}

export function trainingDeviceDetail(model: any) {
  const device = cvTrainingDevice(model);
  if (!device) return "Training runtime status unknown";
  if (cpuTrainingBlocked(model)) return "CPU path disabled";
  if (normalize(device.type) === "directml") return "DirectML cannot train YOLO; use CUDA or WSL ROCm";
  return device.warning || device.name || device.torchVersion || device.selected || "-";
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}
