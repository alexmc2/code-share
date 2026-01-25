// Debug logging utility
// Enable via ?debug=1 query param or VITE_DEBUG=true env

// Check if debug mode is enabled
function isDebugEnabled(): boolean {
  // Check env var
  if (import.meta.env.VITE_DEBUG === 'true') {
    return true;
  }

  // Check query param (only in browser)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1';
  }

  return false;
}

const DEBUG_ENABLED = isDebugEnabled();

// Category colors for console output
const CATEGORY_COLORS: Record<string, string> = {
  session: '#22c55e', // green
  signalling: '#3b82f6', // blue
  webrtc: '#f59e0b', // amber
  yjs: '#a855f7', // purple
  ping: '#06b6d4', // cyan
};

export type DebugCategory =
  | 'session'
  | 'signalling'
  | 'webrtc'
  | 'yjs'
  | 'ping';

/**
 * Log debug message with category coloring
 * Only logs when debug mode is enabled
 */
export function debugLog(category: DebugCategory, ...args: unknown[]): void {
  if (!DEBUG_ENABLED) return;

  const color = CATEGORY_COLORS[category] || '#888';
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS

  console.log(
    `%c[${timestamp}] [${category}]`,
    `color: ${color}; font-weight: bold`,
    ...args,
  );
}

/**
 * Log debug message for received data with size info
 */
export function debugLogData(
  category: DebugCategory,
  direction: 'sent' | 'received',
  peerId: string,
  bytes: number,
  details?: string,
): void {
  if (!DEBUG_ENABLED) return;

  const arrow = direction === 'sent' ? '→' : '←';
  const color = CATEGORY_COLORS[category] || '#888';
  const timestamp = new Date().toISOString().slice(11, 23);

  console.log(
    `%c[${timestamp}] [${category}] ${arrow} ${direction}`,
    `color: ${color}; font-weight: bold`,
    `peer:${peerId}`,
    `${bytes} bytes`,
    details || '',
  );
}

/**
 * Check if debug mode is currently enabled
 */
export function isDebugMode(): boolean {
  return DEBUG_ENABLED;
}

/**
 * Debug state tracker for the debug panel
 */
export interface DebugState {
  sessionId: string | null;
  localPeerId: string | null;
  socketId: string | null;
  isHost: boolean;
  participants: Array<{
    peerId: string;
    name: string;
    isConnected: boolean;
    dataChannelState: string;
  }>;
  yjsSyncedPeers: string[];
  lastRoomState: unknown;
}

// Global debug state for panel access
let debugState: DebugState | null = null;

export function setDebugState(state: Partial<DebugState>): void {
  if (!DEBUG_ENABLED) return;
  debugState = { ...debugState, ...state } as DebugState;
  // Expose to window for DevTools access
  (window as unknown as Record<string, unknown>).__CODE_SHARE_DEBUG__ =
    debugState;
}

export function getDebugState(): DebugState | null {
  return debugState;
}
