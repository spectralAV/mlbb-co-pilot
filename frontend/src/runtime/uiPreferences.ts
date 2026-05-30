import { useEffect, useState } from "react";

const advancedSurfacesStorageKey = "mlbb.ui.showAdvancedSurfaces";
const advancedSurfacesChangedEvent = "mlbb:advanced-surfaces-changed";

export function getAdvancedSurfacesVisible() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(advancedSurfacesStorageKey) === "1";
}

export function setAdvancedSurfacesVisible(visible: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(advancedSurfacesStorageKey, visible ? "1" : "0");
  window.dispatchEvent(new CustomEvent(advancedSurfacesChangedEvent, { detail: visible }));
}

export function useAdvancedSurfacesVisible() {
  const [visible, setVisible] = useState(getAdvancedSurfacesVisible);

  useEffect(() => {
    const sync = () => setVisible(getAdvancedSurfacesVisible());
    window.addEventListener("storage", sync);
    window.addEventListener(advancedSurfacesChangedEvent, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(advancedSurfacesChangedEvent, sync);
    };
  }, []);

  return [visible, setAdvancedSurfacesVisible] as const;
}
