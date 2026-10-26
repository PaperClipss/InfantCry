const test = require('node:test');
const assert = require('node:assert/strict');
const { resampleMono, encodePcm16Wav, readWavMetadata } = require('../www/audio-utils.js');

test('resampler returns expected length for 48 kHz to 16 kHz', () => {
  const input = new Float32Array(48000);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
  const output = resampleMono(input, 48000, 16000);
  assert.equal(output.length, 16000);
  assert.ok(output.every(Number.isFinite));
});

test('WAV encoder writes mono 16 kHz PCM16 metadata', async () => {
  const samples = new Float32Array([0, 0.25, -0.25, 1, -1]);
  const blob = encodePcm16Wav(samples, 16000);
  assert.equal(blob.type, 'audio/wav');
  const metadata = await readWavMetadata(blob);
  assert.equal(metadata.sampleRate, 16000);
  assert.equal(metadata.channels, 1);
  assert.equal(metadata.bitDepth, 16);
  assert.equal(metadata.formatCode, 1);
  assert.equal(metadata.dataBytes, 10);
  assert.equal(metadata.fileBytes, 54);
});

test('same-rate resampling retains the sample values', () => {
  const input = new Float32Array([0, 0.1, -0.2, 0.9]);
  const output = resampleMono(input, 16000, 16000);
  assert.deepEqual(Array.from(output), Array.from(input));
});
