/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVEKIT_URL?: string;
  readonly VITE_LIVEKIT_TOKEN?: string;
  readonly VITE_LIVEKIT_ROOM?: string;
  readonly VITE_LIVEKIT_IDENTITY?: string;
  readonly VITE_GATEWAY_URL?: string;
  readonly VITE_TOKEN_SERVER_URL?: string;
  readonly VITE_TRANSCRIBE_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
