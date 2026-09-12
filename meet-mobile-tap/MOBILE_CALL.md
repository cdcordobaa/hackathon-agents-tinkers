# Conectar el móvil a una llamada web

Web y móvil entran al mismo proyecto LiveKit y al mismo nombre de sala. El móvil
publica su micrófono; el participante `xentinela-monitor` procesa el audio en el
servidor con Gemini y devuelve la transcripción y la evaluación a los dos clientes.

## 1. Gateway en el computador

Actualiza el repositorio a `main`. Para una instalación nueva:

```bash
cd meet-mobile-tap
npm run setup:gateway
npm run dev
```

El gateway imprime `Phone gateway URL: http://<IP-LAN>:8787`.
Las credenciales de LiveKit y Gemini se configuran en el archivo ignorado `agent/.env`.
Si el gateway ya está atendiendo una llamada, mantenlo abierto.

En la web del computador, abre `http://localhost:8787`, elige una sala (por ejemplo
`demo`), introduce tu nombre, selecciona **Other caller**, acepta el consentimiento
y pulsa **Join live call**. La opción **Open demo preview** es una simulación y no
crea una llamada a la que pueda entrar el teléfono.

## 2. App móvil

Conecta el teléfono y el computador a la misma Wi-Fi. Configura en `mobile/.env`:

```dotenv
EXPO_PUBLIC_GATEWAY_URL=http://<IP-LAN>:8787
```

Para servir el código actualizado a una build de desarrollo ya instalada:

```bash
cd meet-mobile-tap/mobile
npm ci
npx expo start --dev-client --clear
```

Abre esa build en el teléfono y conecta con Metro. Si aún no tienes una build nativa,
créala e instálala con `npx expo run:android --device` o `npx expo run:ios --device`
(iOS requiere Xcode y la configuración de firma correspondiente). LiveKit requiere
esa build nativa; Expo Go no incluye sus módulos.

Dentro de la app:

1. Selecciona **LiveKit room**.
2. En **Gateway URL**, introduce la dirección LAN que imprimió el gateway.
3. En **Room**, escribe exactamente la sala de la web, por ejemplo `demo`.
4. Introduce un nombre distinto y selecciona **Protected person**.
5. Pulsa **Continue**, acepta el consentimiento y pulsa **Start the call**.
6. Permite el micrófono y, en iOS, el acceso a la red local cuando se solicite.

No se pegan tokens ni claves de proveedores en el teléfono. La app obtiene un token
de entrada a esa sala mediante `/api/join` después del consentimiento.

## 3. Comprobar el procesamiento

Usa audífonos y habla desde ambos dispositivos. Deben aparecer ambos participantes,
audio en ambas direcciones, sus medidores y el estado **Call in progress**.

El monitor transcribe bloques de aproximadamente 12 segundos. Después del primer
bloque hablado y de las respuestas de los modelos, aparecen la transcripción y el
riesgo. El análisis ocurre en el servidor; la app no necesita iniciar otro proceso.
Si no hay una evaluación actual, muestra espera o un estado degradado, sin inventar
una puntuación.

Si el teléfono no conecta, abre `http://<IP-LAN>:8787/api/health` en su navegador.
Esto comprueba el acceso al gateway. Verifica la Wi-Fi, la dirección LAN y que el
proceso del gateway siga abierto. El nombre `localhost` en un teléfono físico se
refiere al propio teléfono.

Salir desde el móvil desconecta ese participante. La llamada web puede continuar.
El resumen móvil contiene lo recibido durante la conexión, no un informe final persistido.

## Usar dos grabaciones para la demostración

En la web, selecciona el modo de llamada grabada y carga un archivo por voz: primero
el otro interlocutor y después la persona protegida. Cada archivo representa una
intervención completa. Se reproducen en ese orden, separados por una pausa breve;
si contienen varias intervenciones mezcladas, prepara primero los turnos correspondientes.

Usa una sala nueva para cada demostración, por ejemplo `audio-demo`, y conecta el móvil
a esa misma sala antes de iniciar la reproducción. Mantén silenciado el micrófono del
móvil para evitar que vuelva a capturar las grabaciones que escucha por el altavoz.

La web publica las voces como dos participantes distintos. El micrófono del computador
permanece apagado y los archivos se decodifican localmente. Al iniciar, el audio viaja
por LiveKit al monitor y se procesa con Gemini, igual que una conversación en vivo.
El rótulo de grabación identifica la simulación; la transcripción y el riesgo son reales.

Espera a que termine el procesamiento después de la reproducción. La web identifica
el último resultado recibido como una evaluación de la grabación; en el móvil puedes
consultar también el resumen al salir. El botón de salida detiene los participantes
de grabación, sin cerrar los otros participantes de la sala.
