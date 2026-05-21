import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { DraftRoom } from "./pages/DraftRoom";
import { BuildLab } from "./pages/BuildLab";
import { TacticalMap } from "./pages/TacticalMap";
import { MapTrainer } from "./pages/MapTrainer";
import { LiveCapture } from "./pages/LiveCapture";
import { ModuleManager } from "./pages/ModuleManager";
import { Settings } from "./pages/Settings";
import { OverlayPreview } from "./pages/OverlayPreview";
import { Calibration } from "./pages/Calibration";
import { GamePage } from "./pages/GamePage";
import { GameAnalysis } from "./pages/GameAnalysis";
import { GameOverlay } from "./pages/GameOverlay";
import "./styles.css";

const queryClient = new QueryClient();
const router = createBrowserRouter([
  { path: "/overlay", element: <OverlayPreview /> },
  { path: "/game-overlay", element: <GameOverlay /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "draft", element: <DraftRoom /> },
      { path: "game", element: <GamePage /> },
      { path: "analysis", element: <GameAnalysis /> },
      { path: "build", element: <BuildLab /> },
      { path: "map", element: <TacticalMap /> },
      { path: "map-trainer", element: <MapTrainer /> },
      { path: "capture", element: <LiveCapture /> },
      { path: "overlay-preview", element: <OverlayPreview /> },
      { path: "calibration", element: <Calibration /> },
      { path: "modules", element: <ModuleManager /> },
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
