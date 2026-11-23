"use client";

import React, {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  APP_TITLES,
  type AppId,
  type IntentRecord,
  type OrbState,
  type WindowInstance,
  type WizardState,
  type WizardType,
} from "@/components/os/wm/windowTypes";

type OSState = {
  windows: WindowInstance[];
  activeApp: AppId | null;
  orbState: OrbState;
  intents: IntentRecord[];
  wizard: WizardState;
  isOrbPanelOpen: boolean;
  isThinking: boolean;
  confirmation: string | null;
  nextZIndex: number;
};

type Action =
  | { type: "OPEN_APP"; appId: AppId }
  | { type: "CLOSE_WINDOW"; windowId: string }
  | { type: "MINIMIZE_WINDOW"; windowId: string }
  | { type: "TOGGLE_MAXIMIZE"; windowId: string }
  | { type: "FOCUS_WINDOW"; windowId: string }
  | { type: "ADD_INTENT"; intent: IntentRecord }
  | { type: "OPEN_WIZARD"; wizardType: WizardType; intentId?: string }
  | { type: "CLOSE_WIZARD" }
  | { type: "SET_ORB_STATE"; orbState: OrbState }
  | { type: "SET_ORB_PANEL"; isOpen: boolean }
  | { type: "SET_THINKING"; isThinking: boolean }
  | { type: "SET_CONFIRMATION"; message: string | null };

const defaultWindowByApp: Record<AppId, Omit<WindowInstance, "id" | "zIndex" | "title" | "type">> = {
  mail: { position: { x: 80, y: 120 }, size: { width: 980, height: 560 }, isMinimized: false, isMaximized: false },
  calendar: { position: { x: 140, y: 140 }, size: { width: 920, height: 560 }, isMinimized: false, isMaximized: false },
  tasks: { position: { x: 180, y: 160 }, size: { width: 760, height: 520 }, isMinimized: false, isMaximized: false },
  files: { position: { x: 200, y: 130 }, size: { width: 860, height: 540 }, isMinimized: false, isMaximized: false },
  slides: { position: { x: 220, y: 150 }, size: { width: 940, height: 560 }, isMinimized: false, isMaximized: false },
  docs: { position: { x: 210, y: 145 }, size: { width: 900, height: 560 }, isMinimized: false, isMaximized: false },
  settings: { position: { x: 260, y: 170 }, size: { width: 720, height: 500 }, isMinimized: false, isMaximized: false },
};

const initialWindows: WindowInstance[] = [
  {
    id: "mail-1",
    type: "mail",
    title: APP_TITLES.mail,
    zIndex: 20,
    ...defaultWindowByApp.mail,
  },
  {
    id: "calendar-1",
    type: "calendar",
    title: APP_TITLES.calendar,
    zIndex: 21,
    ...defaultWindowByApp.calendar,
  },
];

const initialState: OSState = {
  windows: initialWindows,
  activeApp: "calendar",
  orbState: "idle",
  intents: [],
  wizard: { isOpen: false, type: null, intentId: null },
  isOrbPanelOpen: false,
  isThinking: false,
  confirmation: null,
  nextZIndex: 22,
};

function makeWindow(appId: AppId, zIndex: number, count: number): WindowInstance {
  const preset = defaultWindowByApp[appId];
  return {
    id: `${appId}-${count + 1}`,
    type: appId,
    title: APP_TITLES[appId],
    zIndex,
    position: { x: preset.position.x + (count % 3) * 20, y: preset.position.y + (count % 3) * 16 },
    size: preset.size,
    isMinimized: false,
    isMaximized: false,
  };
}

function reducer(state: OSState, action: Action): OSState {
  switch (action.type) {
    case "OPEN_APP": {
      const existing = state.windows.find((window) => window.type === action.appId);
      if (existing) {
        const nextZ = state.nextZIndex;
        return {
          ...state,
          activeApp: action.appId,
          windows: state.windows.map((window) =>
            window.id === existing.id
              ? { ...window, isMinimized: false, zIndex: nextZ }
              : window
          ),
          nextZIndex: nextZ + 1,
        };
      }

      const count = state.windows.filter((window) => window.type === action.appId).length;
      const created = makeWindow(action.appId, state.nextZIndex, count);
      return {
        ...state,
        activeApp: action.appId,
        windows: [...state.windows, created],
        nextZIndex: state.nextZIndex + 1,
      };
    }
    case "CLOSE_WINDOW": {
      const windows = state.windows.filter((window) => window.id !== action.windowId);
      const top = [...windows].sort((a, b) => b.zIndex - a.zIndex)[0] ?? null;
      return {
        ...state,
        windows,
        activeApp: top?.type ?? null,
      };
    }
    case "MINIMIZE_WINDOW": {
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === action.windowId ? { ...window, isMinimized: true } : window
        ),
      };
    }
    case "TOGGLE_MAXIMIZE": {
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === action.windowId
            ? { ...window, isMaximized: !window.isMaximized, isMinimized: false }
            : window
        ),
      };
    }
    case "FOCUS_WINDOW": {
      const target = state.windows.find((window) => window.id === action.windowId);
      if (!target) return state;
      const nextZ = state.nextZIndex;
      return {
        ...state,
        activeApp: target.type,
        windows: state.windows.map((window) =>
          window.id === action.windowId ? { ...window, zIndex: nextZ, isMinimized: false } : window
        ),
        nextZIndex: nextZ + 1,
      };
    }
    case "ADD_INTENT": {
      return {
        ...state,
        intents: [action.intent, ...state.intents].slice(0, 12),
      };
    }
    case "OPEN_WIZARD": {
      return {
        ...state,
        wizard: {
          isOpen: true,
          type: action.wizardType,
          intentId: action.intentId ?? null,
        },
        isOrbPanelOpen: false,
      };
    }
    case "CLOSE_WIZARD": {
      return {
        ...state,
        wizard: { isOpen: false, type: null, intentId: null },
      };
    }
    case "SET_ORB_STATE": {
      return {
        ...state,
        orbState: action.orbState,
      };
    }
    case "SET_ORB_PANEL": {
      return {
        ...state,
        isOrbPanelOpen: action.isOpen,
      };
    }
    case "SET_THINKING": {
      return {
        ...state,
        isThinking: action.isThinking,
      };
    }
    case "SET_CONFIRMATION": {
      return {
        ...state,
        confirmation: action.message,
      };
    }
    default:
      return state;
  }
}

type StoreValue = {
  state: OSState;
  dispatch: Dispatch<Action>;
};

const OSStoreContext = createContext<StoreValue | null>(null);

export function OSStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return React.createElement(OSStoreContext.Provider, { value }, children);
}

export function useOSStore() {
  const context = useContext(OSStoreContext);
  if (!context) {
    throw new Error("useOSStore must be used inside OSStoreProvider");
  }
  return context;
}
