

# CodeShare

Un editor de código colaborativo y pizarra basado en el navegador, en tiempo real y sin necesidad de cuentas, diseñado para programación en pareja. Peer-to-peer a través de WebRTC con soporte TURN para el traversal de NAT.

![image](public/image.png)

![gif](public/demo.gif)

## Características

- **Editor de Código Colaborativo**: Monaco Editor (más de 10 idiomas) con formato prettier para los idiomas compatibles
- **Pizarra**: Dibujo basado en Canvas con herramientas de lápiz, línea, rectángulo y círculo
- **Chat en Vivo**: Mensajería en tiempo real sincronizada entre todos los participantes
- **Peer-to-Peer**: El contenido fluye directamente entre navegadores a través de WebRTC
- **Sin Cuentas**: Solo crea una sesión y comparte el enlace
- **Privacidad Primero**: El servidor solo maneja la señalización, nunca ve tu contenido

## Inicio Rápido

### Requisitos previos

- Node.js 18+
- npm 9+

### Desarrollo local

1. **Clonar e instalar dependencias:**

```bash
# Install client dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..
```

2. **Iniciar los servidores de desarrollo:**

```bash
# Terminal 1: Start signalling server
cd server && npm run dev

# Terminal 2: Start client dev server
npm run dev
```

3. **Abrir la aplicación:**
   - Visita http://localhost:5173
   - Haz clic en "Crear Sesión"
   - Abre el enlace de la sesión en otra pestaña del navegador para probar la colaboración

## Despliegue en Producción

### Opción 1: Docker Compose (Recomendada)

```bash
# Build and run both services
docker compose up -d

# Access at http://localhost (client) and http://localhost:3001 (signalling)
```

### Opción 2: Despliegue manual

#### Construir el cliente:

```bash
npm run build
# Output in ./dist - serve with any static file server
```

#### Construir y ejecutar el servidor:

```bash
cd server
npm run build
NODE_ENV=production npm start
```

### Despliegue en una VM de Ubuntu con Caddy

1. **Instalar dependencias:**

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Caddy
sudo apt install -y caddy
```

2. **Construir y desplegar:**

```bash
# Clone your repo
git clone your-repo-url /opt/codeshare
cd /opt/codeshare

# Build client
npm install && npm run build

# Build server
cd server && npm install && npm run build && cd ..
```

3. **Crear servicio systemd para el servidor de señalización:**

```bash
sudo tee /etc/systemd/system/codeshare.service << EOF
[Unit]
Description=CodeShare Signalling Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/codeshare/server
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=CORS_ORIGINS=https://your-domain.com
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable codeshare
sudo systemctl start codeshare
```

4. **Configurar Caddy:**

```bash
sudo tee /etc/caddy/Caddyfile << EOF
your-domain.com {
    # Serve static files
    root * /opt/codeshare/dist
    file_server

    # SPA fallback
    try_files {path} /index.html

    # Proxy WebSocket to signalling server
    handle /socket.io/* {
        reverse_proxy localhost:3001
    }
}
EOF

sudo systemctl reload caddy
```

## Variables de Entorno

### Cliente (`.env`)

Copia `.env.example` a `.env` y configura:

| Variable               | Descripción                    | Predeterminado                        |
| ---------------------- | ------------------------------ | ------------------------------ |
| `VITE_SIGNALLING_URL`  | URL del servidor de señalización          | `http://localhost:3001`        |
| `VITE_STUN_URLS`       | Servidores STUN (separados por comas) | `stun:stun.l.google.com:19302` |
| `VITE_TURN_URLS`       | URLs del servidor TURN (opcional)    | -                              |
| `VITE_TURN_USERNAME`   | Usuario TURN                  | -                              |
| `VITE_TURN_CREDENTIAL` | Credencial TURN                | -                              |

### Servidor

| Variable       | Descripción                       | Predeterminado                 |
| -------------- | --------------------------------- | ----------------------- |
| `PORT`         | Puerto del servidor                       | `3001`                  |
| `CORS_ORIGINS` | Orígenes permitidos (separados por comas) | `http://localhost:5173` |
| `NODE_ENV`     | Entorno                       | `development`           |

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Clients                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    WebRTC Data Channel    ┌─────────────┐  │
│  │   Client A  │◄──────────────────────────│   Client B  │  │
│  │             │                           │             │  │
│  │  - Monaco   │   Yjs CRDT Sync:          │  - Monaco   │  │
│  │  - Canvas   │   • Code (Y.Text)         │  - Canvas   │  │
│  │  - Chat     │   • Whiteboard (Y.Array)  │  - Chat     │  │
│  └──────┬──────┘   • Chat (Y.Array)        └──────┬──────┘  │
│         │                                         │         │
│         │     Socket.IO (signalling only)         │         │
│         └────────────────┬────────────────────────┘         │
│                          │                                  │
├──────────────────────────┼──────────────────────────────────┤
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                Signalling Server                        ││
│  │  • Room membership (in-memory)                          ││
│  │  • WebRTC offer/answer/ICE relay                        ││
│  │  • NO content storage                                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Componentes clave

- **Servidor de Señalización** (`/server`): Express + Socket.IO para la coordinación de WebRTC
- **Gestor WebRTC** (`/src/lib/webrtc.ts`): Maneja las conexiones entre pares y los canales de datos
- **Proveedor Yjs** (`/src/lib/yjs-provider.ts`): Proveedor personalizado que sincroniza Yjs a través de WebRTC
- **Contexto de Sesión** (`/src/lib/session.tsx`): Contexto de React que gestiona el estado de la sesión

## Configuración del Servidor TURN

Para usuarios detrás de NAT estrictos o firewalls corporativos, necesitarás un servidor TURN:

### Opción 1: Servicios alojados

- [Twilio TURN](https://www.twilio.com/docs/stun-turn)
- [Metered TURN](https://www.metered.ca/tools/openrelay/)

### Opción 2: Coturn autoalojado

```bash
sudo apt install coturn
sudo tee /etc/turnserver.conf << EOF
listening-port=3478
tls-listening-port=5349
realm=your-domain.com
server-name=your-domain.com
lt-cred-mech
user=username:password
EOF
sudo systemctl enable coturn
sudo systemctl start coturn
```

Luego configura las variables de entorno:

```
VITE_TURN_URLS=turn:your-domain.com:3478
VITE_TURN_USERNAME=username
VITE_TURN_CREDENTIAL=password
```

## Limitaciones conocidas

- **Sin cursores remotos**: El intercambio de cursores de Monaco no está implementado en el MVP

## Requisitos de Despliegue

> [!IMPORTANT]
> **El servidor de señalización debe tener estado**
>
> El servidor de señalización mantiene en memoria el estado de pertenencia a la sala y la elección del host. Esto significa:
>
> - **Instancia única**: Desplegar como un único proceso persistente, no como una función sin servidor (serverless)
> - **Sesiones fijas (sticky sessions)**: Si hay balanceo de carga, configura sesiones fijas (afinidad de sesión) para que todas las conexiones WebSocket del mismo cliente lleguen a la misma instancia
> - **WSS requerido**: Usa WebSocket Secure (`wss://`) cuando el cliente se sirva a través de HTTPS
> - **No serverless**: NO despliegues en Vercel Edge Functions, Cloudflare Workers u otras plataformas similares que no admitan conexiones WebSocket persistentes
>
> Si necesitas escalado horizontal, añade un adaptador de estado compartido (por ejemplo, `@socket.io/redis-adapter`) para sincronizar el estado de la sala entre instancias.

## Depuración

Habilita el modo de depuración agregando `?debug=1` a la URL o estableciendo la variable de entorno `VITE_DEBUG=true`. Esto registra:

- IDs de sesión/par/socket
- Actualizaciones del estado de la sala desde el servidor
- Ciclo de vida de la conexión WebRTC (offer/answer, candidatos ICE, estado del canal)
- Eventos de sincronización de Yjs (SyncStep1/2, actualizaciones, awareness)

El estado de depuración también se expone en `window.__CODE_SHARE_DEBUG__` para su inspección con DevTools.

## Tecnologías (Tech Stack)

- **Cliente**: Vite + React 19 + TypeScript
- **Editor**: Monaco Editor
- **Tiempo real**: Yjs CRDT + proveedor WebRTC personalizado
- **Señalización**: Socket.IO
- **Servidor**: Express + Node.js
