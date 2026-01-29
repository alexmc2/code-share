/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALLING_URL: string;
  readonly VITE_STUN_URLS: string;
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  webkitAudioContext: typeof AudioContext;
}
