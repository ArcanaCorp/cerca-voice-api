# CERCA Voice API — OpenRouter + Groq

Backend independiente para la app [CERCA](https://github.com/ArcanaCorp/cerca). Permite probar IA **sin recargar OpenAI**: usa OpenRouter (texto e identidad) y Groq Whisper (transcripción), sujetos a los límites gratuitos vigentes. La reproducción de voz usa `expo-speech` del dispositivo Android; no es una llamada en tiempo real.

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/health` | Estado del servicio (no verifica la API externa) |
| POST | `/api/companion` | Genera identidad de compañero: nombre, género, personalidad Big Five, intereses, humor y estilo |
| POST | `/api/voice-turn` | Audio M4A/base64 → Groq → OpenRouter → texto de respuesta y recuerdo |

### `POST /api/companion`

Solicitud:

```json
{"preference":"random","user":{"name":"Ana","language":"es","interests":["arte","naturaleza"]}}
```

Respuesta (los valores son generados por IA, no prefijados):

```json
{
  "name":"nombre creado por la IA",
  "gender":"female",
  "personality":{"openness":70,"conscientiousness":58,"extraversion":51,"agreeableness":67,"neuroticism":34},
  "interests":["fotografía","astronomía","cocina"],
  "humor":"se ríe de las coincidencias inesperadas",
  "communicationStyle":"curiosa, relajada y directa"
}
```

La aplicación **guarda esta identidad localmente en SQLite una única vez** y la conserva en próximas aperturas. Para generar una nueva se debe eliminar el perfil anterior con el consentimiento correspondiente.

### `POST /api/voice-turn`

Se mantiene compatible con la app: JSON con `audio` (M4A base64), `mimeType: "audio/mp4"`, `user`, `companion`, `history` y `memories`.

Respuesta: `{"transcript":"...","reply":"...","memory":""}`. Solo devuelve hechos a recordar cuando la persona lo pide explícitamente. El servidor no almacena conversaciones, audios ni recuerdos.

## Configurar en Vercel

1. Importar este repositorio en [Vercel](https://vercel.com/new) como **Other**, Node.js 22, raíz del proyecto, sin comando de build.
2. Crear una clave en [OpenRouter](https://openrouter.ai/settings/keys) y otra en [Groq](https://console.groq.com/keys).
3. Añadir variables de entorno privadas en el proyecto Vercel:
   - `OPENROUTER_API_KEY`: clave secreta de OpenRouter.
   - `OPENROUTER_MODEL=openrouter/free`: modelos gratuitos, sujetos a disponibilidad.
   - `GROQ_API_KEY`: clave de Groq.
   - `GROQ_WHISPER_MODEL=whisper-large-v3-turbo`.
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_SALT`: protección de consumo en producción anónima. Solo guarda contadores, no conversaciones.
   - `REQUESTS_PER_MINUTE=8`, `DAILY_REQUESTS_LIMIT=45` (ajustables a las cuotas vigentes).
4. Desplegar. Probar `https://tu-proyecto.vercel.app/api/health`.
5. En la app `ArcanaCorp/cerca` configurar **solo** `EXPO_PUBLIC_CERCA_API_URL=https://tu-proyecto.vercel.app` (sin `/api` al final). Reiniciar Expo.
6. Completar onboarding, aceptar autorización de identidad y de audio por separado, y probar conversación.

**Importante:** configura primero el backend y verifica las cuotas reales de los proveedores. Si no hay contadores Upstash configurados en producción y no se usa token de servidor, la API responde 503 a propósito para evitar gastos por abuso.

No guardar `OPENROUTER_API_KEY` ni `GROQ_API_KEY` dentro de `EXPO_PUBLIC_*`, código cliente o APK. El dominio de Vercel y CORS **no autentican** un dispositivo móvil. Antes de distribuir, habilitar autenticación/atestación de instalaciones y límites efectivos por consumidor; Upstash ayuda pero no es una defensa suficiente por sí sola.

Las solicitudes son procesadas por Vercel y los proveedores externos según sus políticas de privacidad/retención. Las cuentas gratis pueden tener condiciones distintas de las de pago; obtenemos consentimiento antes de enviar información. La memoria y personalidad se guardan en SQLite local **sin cifrar** todavía.

## Pruebas locales

Requiere Node.js 22 o posterior y no necesita dependencias npm de terceros.

```bash
npm ci
npm run check
npm test
npm start
```

Servidor local: `http://localhost:3000/api/health`; para Android con Expo se necesita túnel HTTPS. Las pruebas automatizadas usan respuestas simuladas de OpenRouter/Groq y **no consumen cuotas reales**.

Cuando queramos una conversación continua con interrupciones naturales, migrar la capa de voz a streaming/audio en tiempo real; por ahora es pulsar → hablar → esperar → escuchar.

## Diagnóstico de fallos en Upstash

En Vercel > Settings > Environment Variables define `CERCA_DEBUG_LOGS=true`, aplica al entorno correcto (Production/Preview) y vuelve a desplegar. Abre **Vercel Logs**, realiza una interacción y busca el prefijo `[CERCA-API]` y su `requestId`.

Eventos útiles:
- `quota_config`: indica **solo si existen** URL, token y salt (sin mostrarlos).
- `quota_upstash_request`: comenzó la solicitud de límites.
- `quota_network_failure`: conexión/timeout a Upstash.
- `quota_upstash_http_failure`: Upstash devolvió 401/403/404/429/500; comprueba REST URL, REST TOKEN, región y despliegue.
- `quota_upstash_invalid_json` o `quota_upstash_invalid_result`: formato de respuesta incorrecto.
- `quota_upstash_ok` y `quota_passed`: protección validada; luego se espera `groq_transcription_start`, `groq_transcription_ok` y `openrouter_response_start`.
- `request_failed`: error con estado y código técnico.
La respuesta incluye `requestId` en errores y el header `X-CERCA-Request-ID` para correlacionar con el dispositivo.

Un `PING` exitoso desde PowerShell demuestra que **esa máquina** llega a Upstash, pero no que el despliegue actual de Vercel tenga las mismas variables. Nunca pegues tokens, audios ni respuestas completas de usuario en logs o tickets.

## Calidad de respuestas y transcripciones

Si OpenRouter devuelve texto como `User Safety: safe` / `Response Safety: safe`, la API ahora **rechaza la respuesta** con `code: non_conversational_model` (HTTP 502) en lugar de reproducirla o guardarla. `openrouter/free` elige modelos aleatoriamente y puede seleccionar uno especializado en moderación.

Para conversaciones estables, configura `OPENROUTER_MODEL` con el **identificador exacto de un modelo gratuito de chat**, disponible en [el catálogo de OpenRouter](https://openrouter.ai/models?pricing=free). Evita modelos cuyo nombre contenga `content-safety`, `moderation` o `rerank`.

Groq recibirá el idioma configurado por la persona (`es` o `en`) y una indicación breve del contexto lingüístico. Esto reduce detecciones erróneas de idioma, pero no garantiza una transcripción perfecta.

Nunca imprimas el contenido de los mensajes en logs de producción. Los diagnósticos muestran únicamente códigos, tamaños y modelo seleccionado. La app filtra las etiquetas antiguas del contexto; pueden borrarse manualmente desde Settings.

## Fallos de cuota gratuita (HTTP 429)

OpenRouter puede limitar llamadas por minuto, por día o por saturación del proveedor.
Consulta tu cuota en el panel de OpenRouter o con `GET https://openrouter.ai/api/v1/key`
usando tu clave **desde una terminal privada**, nunca desde la APK.

Para activar una alternativa de chat con Groq (además de la transcripción):
```env
GROQ_TEXT_FALLBACK_ENABLED=true
GROQ_TEXT_MODEL=openai/gpt-oss-20b
```
Configura estas dos variables solo en **Vercel** y vuelve a desplegar. Este modelo
GPT-OSS es open-weight alojado en Groq; no requiere saldo de la API de OpenAI.
Groq tiene sus propias cuotas gratuitas y de pago según la cuenta.

La API intenta OpenRouter una vez y, si el resultado falla por cuota,
disponibilidad, clasificación o formato, intenta Groq **una sola vez**.
Si Groq también falla, devuelve su error; no entra en un bucle de reintentos.
No modifica `/api/voice-turn` ni `/api/companion` y tampoco altera SQLite.

El backend nunca incluye los tokens de proveedores en los mensajes de error.
Las transcripciones mal detectadas pueden ser señal de audio de baja calidad:
Whisper ya recibe el idioma de conversación configurado en el perfil.
