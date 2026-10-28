'use strict';
const { ApiError, text } = require('./guard.cjs');
const { makeInstructions, requestedRemember, redactMemoryCandidate } = require('./prompt.cjs');
const { requestJSON } = require('./openrouter.cjs');
const { transcribe } = require('./groq.cjs');

async function voiceTurn(input, options) {
  options?.trace?.log('groq_transcription_start', { audioBytes: input.audio.length });
  const transcript = await transcribe(input.audio, options);
  options?.trace?.log('groq_transcription_ok', { transcriptChars: transcript.length });
  options?.trace?.log('openrouter_response_start');
  const obj = await requestJSON({
    system: makeInstructions(input),
    messages: [...input.history, { role: 'user', content: transcript }],
    temperature: 0.85,
    maxTokens: 450
  }, options);
  options?.trace?.log('openrouter_response_ok');
  const reply = text(obj.reply, 900);
  if (!reply) throw new ApiError(502, 'empty_reply', 'La IA no respondió. Intenta nuevamente.');
  const memory = requestedRemember(transcript) ? redactMemoryCandidate(obj.memory) : '';
  return { transcript, reply, memory };
}
module.exports = { voiceTurn };
