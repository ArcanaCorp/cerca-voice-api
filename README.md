# CERCA Voice API

Servicio **independiente** para la app móvil CERCA de ARCANA CORP. Listo para desplegar como Vercel Functions con Node 22, sin login ni base de datos de conversaciones en el servidor.

## ¿Qué hace?

`POST /api/voice-turn` conserva **exactamente** el contrato que utiliza `src/services/voice.service.js` en la app:

1. Recibe audio M4A en base64 (hasta 2.5 MB), perfil del usuario y personalidad persistente del compañero.
2. Transcribe con `gpt-transcribe` de OpenAI.
3. Envía una conversación breve y los recuerdos locales del dispositivo a un modelo de texto configurable (por defecto `gpt-4.1-mini`).
4. Devuelve `{ "transcript": "...", "reply": "...", "memory": "..." }`.
5. **No guarda audio, historial ni recuerdos en servidor**. Los devuelve a la app, que se encarga de persistirlos en SQLite y reproducir `reply` con `expo-speech`.

Es un motor de voz **por turnos**, no una llamada bidireccional de baja latencia.

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/health` | Salud del proceso; no verifica ni consume OpenAI |
| `POST` | `/api/voice-turn` | Transcribir y responder |

Ejemplo conceptual de solicitud:

```json
{
  "audio": "BASE64_M4A",
  "mimeType": "audio/mp4",
  "user": { "name": "Ana", "language": "es", "interests": ["Música"] },
  "companion": { "name": "Lucas", "gender": "male", "personality": {"extraversion": 60}, "interests": ["Astronomía"], "humor": "Ingenioso", "communicationStyle": "Tranquilo" },
  "memories": ["Le gusta el té verde"],
  "history": [{"role":"assistant", "content":"¡Hola!"}]
}
```

## Desplegar en Vercel

1. Crear un repositorio privado nuevo, preferiblemente `ArcanaCorp/cerca-voice-api`, y subir **estos archivos** (ver comandos al final).
2. En [vercel.com/new](https://vercel.com/new), importar el repositorio. Framework: **Other**, directorio raíz: `/`. No requiere comando de build.
3. En **Settings → Environment Variables** del proyecto, agregar:

   - `OPENAI_API_KEY`: clave secreta de la API (solamente servidor).
   - `OPENAI_TRANSCRIPTION_MODEL`: `gpt-transcribe` (opcional).
   - `OPENAI_TEXT_MODEL`: `gpt-4.1-mini` (opcional).
   - `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`: **obligatorios para uso móvil sin autenticación en producción**; guardan contadores de abuso, **no conversaciones**. Crear una base Redis HTTP con Upstash y copiar sus credenciales.
   - `RATE_LIMIT_SALT`: cadena aleatoria privada; opcional pero recomendada para no usar el IP bruto en los contadores.
   - `REQUESTS_PER_MINUTE`: `10` (por IP, opcional).
   - `DAILY_REQUESTS_LIMIT`: `1000` (límite global, opcional).

4. Desplegar. Abrir `https://TU-API.vercel.app/api/health`; debe devolver `status: ok`. **Esto no valida las credenciales de OpenAI**.
5. En CERCA (app Expo), crear `.env.local`:

```env
EXPO_PUBLIC_CERCA_API_URL=https://TU-API.vercel.app
```

6. Ejecutar `npx expo start --clear` y probar una conversación de hasta 20 segundos en Android.

La URL de Vercel **no debe llevar `/api`** al final: la app concatena `/api/voice-turn` automáticamente.

## Seguridad y privacidad

- **Jamás** pongas `OPENAI_API_KEY` en Expo, `EXPO_PUBLIC_*`, APK ni un repositorio público.
- CORS y la URL no autentican una app móvil. El servicio permite llamadas anónimas desde dispositivos porque CERCA todavía no tiene cuentas. La protección incluida en producción son **cuotas persistentes por IP y cuota diaria global** a través de Upstash. Cuando no estén configuradas, la API **responde 503**, en vez de permitir consumo ilimitado. Estos límites reducen el riesgo económico, pero no reemplazan autenticación robusta ni atestación de dispositivos.
- `API_ACCESS_TOKEN` es solo para clientes de servidor en pruebas internas; **no lo incrustes dentro de la APK**. Con token configurado, Vercel acepta esa autenticación, pero sigue siendo necesario establecer límites de gasto/cupos del proveedor.
- El modelo recibe el contexto enviado por la app; ninguna información de conversación queda guardada en esta API. La solicitud **sí pasa por Vercel y OpenAI**, sujetos a su propio tratamiento y retención. `store: false` deshabilita el guardado de estado de Responses, pero no garantiza retención cero.
- El audio no persiste en este servidor, solo se mantiene en memoria durante el proceso. La app móvil se encarga de borrar los archivos temporales.
- Los recuerdos propuestos por el modelo se filtran y solo se devuelven si la persona pide explícitamente recordarlos; las restricciones automáticas no son una garantía absoluta contra información sensible.
- Límite de carga: aproximadamente 2.5 MB de audio y 3.4 MB en base64, dentro del límite de 4.5 MB para cuerpos de Vercel.
- Antes del lanzamiento público, considerar cuentas, App Attest/Play Integrity o autenticación de instalación, límites por usuario, monitoreo de costos y una política de privacidad/consentimiento final.

## Desarrollo local y pruebas

Node >=22. No se necesitan dependencias externas.

```bash
npm ci
npm run check
npm test
npm start
```

Abre `http://localhost:3000/api/health`. Para probar llamadas de voz reales localmente, define `OPENAI_API_KEY` en el entorno de terminal y envía una solicitud de audio válida. La app Expo exige URL HTTPS: utiliza un túnel de desarrollo HTTPS, **no HTTP**, para probar desde un teléfono.

## Crear el nuevo repositorio en GitHub

Desde la carpeta que contiene estos archivos, crea un repositorio privado vacío `cerca-voice-api` en la organización `ArcanaCorp` (sin README ni licencia iniciales). Luego:

```bash
git init -b main
git add .
git commit -m "feat: initial CERCA voice API"
git remote add origin https://github.com/ArcanaCorp/cerca-voice-api.git
git push -u origin main
```

**No es necesario subir la carpeta del proyecto móvil al servidor**. Solo este repositorio se conecta a Vercel.

## Componentes

```text
api/
  health.js                 Verifica que el servicio responda
  voice-turn.js             Endpoint móvil compatible
src/
  guard.cjs                 Validación, control de cuota y autorización opcional
  prompt.cjs                Personalidad y reglas de recuerdo
  openai.cjs                Transcripción + Responses
  voice-handler.cjs         Orquestación sin estado
tests/                      Pruebas automáticas con mocks
.github/workflows/tests.yml CI GitHub Actions
vercel.json                  Configuración función
```
