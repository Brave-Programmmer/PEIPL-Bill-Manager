import React from "react";

export const COMPANION_SETTINGS_STORAGE_KEY = "peipl-companion-settings";
export const COMPANION_SETTINGS_CHANGED_EVENT = "peipl-companion-settings-changed";
export const DEFAULT_DISPLAY_NAME = "Aarathi";

export const getDisplayName = (): string => {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_NAME;

  try {
    const stored = window.localStorage.getItem(COMPANION_SETTINGS_STORAGE_KEY);
    const displayName = stored ? (JSON.parse(stored) as { displayName?: string }).displayName : "";
    return displayName?.trim() || DEFAULT_DISPLAY_NAME;
  } catch {
    return DEFAULT_DISPLAY_NAME;
  }
};

export const useDisplayName = (): string => {
  const [displayName, setDisplayName] = React.useState(getDisplayName);

  React.useEffect(() => {
    const updateDisplayName = () => setDisplayName(getDisplayName());
    window.addEventListener(COMPANION_SETTINGS_CHANGED_EVENT, updateDisplayName);
    return () => window.removeEventListener(COMPANION_SETTINGS_CHANGED_EVENT, updateDisplayName);
  }, []);

  return displayName;
};