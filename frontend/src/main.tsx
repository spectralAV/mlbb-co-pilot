import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Setup } from "./pages/Setup";
import { DraftRoom } from "./pages/DraftRoom";
import { BuildLab } from "./pages/BuildLab";
import { LiveCapture } from "./pages/LiveCapture";
import { Settings } from "./pages/Settings";
import { Calibration } from "./pages/Calibration";
import { SkinGallery } from "./pages/SkinGallery";
import { CvLab } from "./pages/CvLab";
import { CvVideoTool } from "./pages/CvVideoTool";
import { GameAnalysis } from "./pages/GameAnalysis";
import { GameOverlay } from "./pages/GameOverlay";
import { GamePage } from "./pages/GamePage";
import { MapTrainer } from "./pages/MapTrainer";
import { ModuleManager } from "./pages/ModuleManager";
import { PerformanceMonitor } from "./pages/PerformanceMonitor";
import { TacticalMap } from "./pages/TacticalMap";
import { MlbbCounterOutput, MlbbHeroPicksOutput, MlbbLiveOutput, MlbbStreamControl, MlbbStreamOutput, MlbbTacticalMapOutput, MlbbTextPanelOutput } from "./pages/MlbbStreamPack";
import "./styles.css";

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
      { path: "cv-lab", element: <CvLab /> },
      { path: "cv-video", element: <CvVideoTool /> },
      { path: "performance", element: <PerformanceMonitor /> },
      { path: "settings", element: <Settings /> }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
