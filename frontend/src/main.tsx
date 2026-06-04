import React, { Suspense, lazy } from "react";
import type { ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import "./styles.css";

function lazyNamed(loader: () => Promise<any>, exportName: string) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType<any> };
  });
}

function RouteFallback() {
  return <div className="grid min-h-screen place-items-center bg-[#050505] p-6 text-sm font-black uppercase text-cyan-100" role="status" aria-live="polite">Loading</div>;
}

const Dashboard = lazyNamed(() => import("./pages/Dashboard"), "Dashboard");
const Setup = lazyNamed(() => import("./pages/Setup"), "Setup");
const DraftRoom = lazyNamed(() => import("./pages/DraftRoom"), "DraftRoom");
const DraftSimulator = lazyNamed(() => import("./pages/DraftSimulator"), "DraftSimulator");
const BuildLab = lazyNamed(() => import("./pages/BuildLab"), "BuildLab");
const LiveCapture = lazyNamed(() => import("./pages/LiveCapture"), "LiveCapture");
const Settings = lazyNamed(() => import("./pages/Settings"), "Settings");
const Calibration = lazyNamed(() => import("./pages/Calibration"), "Calibration");
const SkinGallery = lazyNamed(() => import("./pages/SkinGallery"), "SkinGallery");
const CvLab = lazyNamed(() => import("./pages/CvLab"), "CvLab");
const CvStudio = lazyNamed(() => import("./pages/CvStudio"), "CvStudio");
const CvStudioDataset = lazyNamed(() => import("./pages/CvStudio"), "CvStudioDataset");
const CvModelEditor = lazyNamed(() => import("./pages/CvModelEditor"), "CvModelEditor");
const CvOcrStudio = lazyNamed(() => import("./pages/CvOcrStudio"), "CvOcrStudio");
const CvVideoTool = lazyNamed(() => import("./pages/CvVideoTool"), "CvVideoTool");
const VideoCvReviewPage = lazyNamed(() => import("./pages/VideoCvReview"), "VideoCvReviewPage");
const GameAnalysis = lazyNamed(() => import("./pages/GameAnalysis"), "GameAnalysis");
const GameOverlay = lazyNamed(() => import("./pages/GameOverlay"), "GameOverlay");
const GamePage = lazyNamed(() => import("./pages/GamePage"), "GamePage");
const MapTrainer = lazyNamed(() => import("./pages/MapTrainer"), "MapTrainer");
const ModuleManager = lazyNamed(() => import("./pages/ModuleManager"), "ModuleManager");
const PerformanceMonitor = lazyNamed(() => import("./pages/PerformanceMonitor"), "PerformanceMonitor");
const TacticalMap = lazyNamed(() => import("./pages/TacticalMap"), "TacticalMap");
const MlbbStreamOutput = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbStreamOutput");
const MlbbTacticalMapOutput = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbTacticalMapOutput");
const MlbbTextPanelOutput = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbTextPanelOutput");
const MlbbCounterOutput = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbCounterOutput");
const MlbbHeroPicksOutput = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbHeroPicksOutput");
const MlbbLiveOutput = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbLiveOutput");
const MlbbStreamControl = lazyNamed(() => import("./pages/MlbbStreamPack"), "MlbbStreamControl");

const queryClient = new QueryClient();
const router = createBrowserRouter([
  { path: "/mlbb-live-output", element: <MlbbLiveOutput /> },
  { path: "/mlbb-output", element: <MlbbStreamOutput /> },
  { path: "/mlbb-map-output", element: <MlbbTacticalMapOutput /> },
  { path: "/mlbb-text-output", element: <MlbbTextPanelOutput /> },
  { path: "/mlbb-counter-output", element: <MlbbCounterOutput /> },
  { path: "/mlbb-picks-output", element: <MlbbHeroPicksOutput /> },
  { path: "/game-overlay", element: <GameOverlay /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "setup", element: <Setup /> },
      { path: "draft", element: <DraftRoom /> },
      { path: "draft-simulator", element: <DraftSimulator /> },
      { path: "game", element: <GamePage /> },
      { path: "analysis", element: <GameAnalysis /> },
      { path: "game-analysis", element: <GameAnalysis /> },
      { path: "skins", element: <SkinGallery /> },
      { path: "build", element: <BuildLab /> },
      { path: "capture", element: <LiveCapture /> },
      { path: "mlbb-control", element: <MlbbStreamControl /> },
      { path: "map", element: <TacticalMap /> },
      { path: "map-trainer", element: <MapTrainer /> },
      { path: "modules", element: <ModuleManager /> },
      { path: "calibration", element: <Calibration /> },
      {
        path: "cv-studio",
        element: <CvStudio />,
        children: [
          { index: true, element: <CvStudioDataset /> },
          { path: "editor", element: <CvModelEditor /> },
          { path: "ocr", element: <CvOcrStudio /> },
          { path: "video", element: <CvVideoTool embedded /> },
          { path: "batch-review", element: <VideoCvReviewPage /> },
          { path: "frame", element: <CvLab embedded /> }
        ]
      },
      { path: "cv-lab", element: <Navigate to="/cv-studio/frame" replace /> },
      { path: "cv-video", element: <Navigate to="/cv-studio/video" replace /> },
      { path: "performance", element: <PerformanceMonitor /> },
      { path: "settings", element: <Settings /> }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<RouteFallback />}>
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>
);
