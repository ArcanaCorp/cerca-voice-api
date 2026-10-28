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
