# Arquitectura de voz continua para CERCA

## Decisión técnica propuesta

**Motor recomendado:** Gemini 3.8 Live (`gemini-3.8-live`), o Gemini 3.1 Flash Live Preview si el acceso/cuota de prueba lo favorece.
**Alternativa paga:** GPT Realtime 2.1 Mini. **Alternativa de voz expresiva gestionada:** Eleven Realtime v1 Mini.
**Fallback existente:** Groq STT + OpenRouter/Groq LLM + Expo Speech mediante `/api/voice-turn`.

### No modificar todavía `/api/voice-turn`

La API por turnos está activa y usa `makeInstructions`. Este cambio agrega un prompt reutilizable `makeRealtimeInstructions`, pero **NO conecta automáticamente Gemini Live**, ni elimina el botón actual. Debe implementarse el transporte de audio nativo en Expo y un endpoint de sesión.

## Sesión continua

1. Al iniciar CERCA, recuperar perfil, identidad estable y recuerdos autorizados desde SQLite.
2. Mostrar botón **iniciar conversación** (solo una vez), estado de conexión y botón **finalizar**. No exigir pulsar para cada intervención.
3. Solicitar al backend una credencial **efímera de Live API**; no incrustar claves Google en la APK. Aplicar cuotas antes de conceder sesión.
4. Conectar mediante WebSocket bidireccional; usar captura PCM 16-bit 16 kHz y salida PCM 24 kHz. Revisar disponibilidad y calidad del audio streaming nativo en Expo SDK 58 / development build antes de comprometer implementación.
5. Configurar Voice Activity Detection (VAD), evitando cortar silencios breves; gestionar interrupciones cancelando el buffer de salida cuando se detecte nueva voz.
6. En cada nueva conexión pasar `makeRealtimeInstructions({user, companion, memories})` como instrucciones del sistema sin forzar JSON en la voz.
7. Configurar compresión de contexto y reanudación de sesión: Google documenta duraciones y reconexiones que requieren gestión activa.
8. Persistir transcripciones del usuario y del compañero en SQLite (con consentimiento explícito). Guardar como memoria durable solo hechos solicitados y permitidos. No prometer que el proveedor externo almacene cero información.
9. Al finalizar sesión, liberar micrófono, audio, WebSocket, credenciales efímeras y buffers. Evitar cobros por sesiones abiertas inadvertidamente.
10. Agregar pruebas: interrupción, silencio largo, ruido, cambios de idioma, reconexión, nueva sesión con recuerdos, eliminación de recuerdos, sin conectividad, límite de cuota.

## Experiencia esperada
- Voz suave sin locución de asistente.
- Respuestas contextuales, longitud variable y preguntas ocasionales.
- No presentarse como IA sin motivo; responder con honestidad si se pregunta.
- Preferir voz nativa de modelo speech-to-speech, no la síntesis del dispositivo, cuando el flujo Live esté activo.

## Fuentes oficiales para la implementación
- Gemini Live API: https://ai.google.dev/gemini-api/docs/live-api
- Tokens efímeros: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Sesiones / compresión / reanudación: https://ai.google.dev/gemini-api/docs/live-api/session-management
- Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

### Consideraciones
La mayoría de proveedores tienen límites gratuitos temporales y pueden desactivar modelos o imponer requisitos de facturación. Verificar acceso efectivo en Google AI Studio y la consola del proyecto antes de integrar. No prometer audio sin cortes absolutos: las redes móviles, latencia y límites de sesión requieren reconexión.
