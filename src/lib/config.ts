// Environment configuration with sensible defaults for local development
export const config = {
  signallingUrl: import.meta.env.VITE_SIGNALLING_URL || 'http://localhost:3001',

  stunUrls: (import.meta.env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim()),

  turnUrls: import.meta.env.VITE_TURN_URLS
    ? import.meta.env.VITE_TURN_URLS.split(',').map((url) => url.trim())
    : [],

  turnUsername: import.meta.env.VITE_TURN_USERNAME || '',
  turnCredential: import.meta.env.VITE_TURN_CREDENTIAL || '',

  // Build ICE server config for RTCPeerConnection
  get iceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = this.stunUrls.map((url) => ({ urls: url }));

    if (this.turnUrls.length > 0 && this.turnUsername && this.turnCredential) {
      servers.push({
        urls: this.turnUrls,
        username: this.turnUsername,
        credential: this.turnCredential,
      });
    }

    return servers;
  },
};
