(function (global) {
  "use strict";

  const TARGET_SAMPLE_RATE = 16000;

  function downmixToMono(audioBuffer) {
    if (!audioBuffer || !audioBuffer.numberOfChannels || !audioBuffer.length) {
      throw new Error("The selected audio could not be decoded or is empty.");
    }
    const mono = new Float32Array(audioBuffer.length);
    const channels = audioBuffer.numberOfChannels;
    for (let channel = 0; channel < channels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels;
    }
    return mono;
  }

  // Windowed-sinc resampler. This performs actual resampling; changing only the WAV
  // header would mislabel the audio and would be incorrect for the 16 kHz model input.
  function resampleMono(input, inputRate, outputRate = TARGET_SAMPLE_RATE) {
    if (!(input instanceof Float32Array) || input.length === 0) {
      throw new Error("There is no audio data to resample.");
    }
    if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) {
      throw new Error("Invalid audio sample rate.");
    }
    if (inputRate === outputRate) return new Float32Array(input);

    const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
    const output = new Float32Array(outputLength);
    const ratio = outputRate / inputRate;
    const cutoff = Math.min(1, ratio) * 0.94;
    const radius = 16;

    for (let i = 0; i < outputLength; i++) {
      const center = i / ratio;
      const start = Math.max(0, Math.floor(center) - radius + 1);
      const end = Math.min(input.length - 1, Math.floor(center) + radius);
      let weightedSum = 0;
      let weightSum = 0;

      for (let j = start; j <= end; j++) {
        const distance = center - j;
        const scaled = distance * cutoff;
        const sinc = Math.abs(scaled) < 1e-8 ? 1 : Math.sin(Math.PI * scaled) / (Math.PI * scaled);
        const normalizedDistance = distance / radius;
        const window = Math.abs(normalizedDistance) >= 1
          ? 0
          : 0.5 + 0.5 * Math.cos(Math.PI * normalizedDistance);
        const weight = cutoff * sinc * window;
        weightedSum += input[j] * weight;
        weightSum += weight;
      }
      output[i] = weightSum ? weightedSum / weightSum : 0;
    }
    return output;
  }

  function encodePcm16Wav(monoSamples, sampleRate = TARGET_SAMPLE_RATE) {
    if (!(monoSamples instanceof Float32Array) || monoSamples.length === 0) {
      throw new Error("Cannot create a WAV file from empty audio.");
    }
    const bytesPerSample = 2;
    const dataBytes = monoSamples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true); // PCM format chunk length
    view.setUint16(20, 1, true);  // PCM encoding
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true); // block alignment
    view.setUint16(34, 16, true); // bits per sample
    writeAscii(view, 36, "data");
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let i = 0; i < monoSamples.length; i++) {
      const sample = Math.max(-1, Math.min(1, monoSamples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function normalizeAudioBuffer(audioBuffer) {
    const mono = downmixToMono(audioBuffer);
    const normalizedSamples = resampleMono(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
    const blob = encodePcm16Wav(normalizedSamples, TARGET_SAMPLE_RATE);
    return {
      blob,
      sampleRate: TARGET_SAMPLE_RATE,
      channels: 1,
      bitDepth: 16,
      duration: normalizedSamples.length / TARGET_SAMPLE_RATE,
      byteLength: blob.size
    };
  }

  async function decodeAndNormalizeWav(file) {
    if (!file || !file.name || !file.name.toLowerCase().endsWith(".wav")) {
      throw new Error("Please choose a WAV file.");
    }
    if (file.size < 44) throw new Error("This WAV file is empty or incomplete.");
    const AudioContextClass = global.AudioContext || global.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Audio conversion is not supported on this device.");

    const context = new AudioContextClass();
    try {
      const bytes = await file.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(bytes.slice(0));
      return await normalizeAudioBuffer(audioBuffer);
    } catch (error) {
      if (error instanceof Error && /choose a WAV|empty or incomplete|not supported/i.test(error.message)) throw error;
      throw new Error("The WAV could not be decoded. Please try a valid PCM WAV recording.");
    } finally {
      try { await context.close(); } catch (_) { /* Context may already be closed. */ }
    }
  }

  function readWavMetadata(blobOrBuffer) {
    return (blobOrBuffer instanceof Promise ? blobOrBuffer : Promise.resolve(blobOrBuffer)).then(async (input) => {
      const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
      if (buffer.byteLength < 44) throw new Error("WAV header is incomplete.");
      const view = new DataView(buffer);
      const fourCC = (offset) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
      if (fourCC(0) !== "RIFF" || fourCC(8) !== "WAVE") throw new Error("The output is not a valid RIFF/WAVE file.");
      return {
        sampleRate: view.getUint32(24, true),
        channels: view.getUint16(22, true),
        bitDepth: view.getUint16(34, true),
        formatCode: view.getUint16(20, true),
        dataBytes: view.getUint32(40, true),
        fileBytes: buffer.byteLength
      };
    });
  }

  function writeAscii(view, offset, value) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }

  const api = { TARGET_SAMPLE_RATE, downmixToMono, resampleMono, encodePcm16Wav, normalizeAudioBuffer, decodeAndNormalizeWav, readWavMetadata };
  global.InfantCryAudioUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
