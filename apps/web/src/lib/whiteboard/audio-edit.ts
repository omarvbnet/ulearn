/** Decode → cut [startMs, endMs) → re-encode as audio/webm via MediaRecorder. */
export async function spliceAudioBlob(
  input: Blob,
  startMs: number,
  endMs: number
): Promise<{ blob: Blob; mimeType: string }> {
  const lo = Math.max(0, Math.min(startMs, endMs));
  const hi = Math.max(startMs, endMs);
  if (hi <= lo) {
    return { blob: input, mimeType: input.type || "audio/webm" };
  }

  const ctx = new AudioContext();
  try {
    const raw = await input.arrayBuffer();
    const buf = await ctx.decodeAudioData(raw.slice(0));
    const rate = buf.sampleRate;
    const startSample = Math.min(buf.length, Math.floor((lo / 1000) * rate));
    const endSample = Math.min(buf.length, Math.floor((hi / 1000) * rate));
    const keep = Math.max(0, buf.length - (endSample - startSample));
    const out = ctx.createBuffer(buf.numberOfChannels, Math.max(1, keep), rate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dest = out.getChannelData(c);
      dest.set(src.subarray(0, startSample), 0);
      if (endSample < src.length) {
        dest.set(src.subarray(endSample), startSample);
      }
    }
    return encodeAudioBuffer(out);
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function encodeAudioBuffer(buffer: AudioBuffer): Promise<{ blob: Blob; mimeType: string }> {
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
  try {
    const dest = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => reject(new Error("AUDIO_ENCODE_FAILED"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    recorder.start(100);
    source.start(0);
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
    // Let the recorder flush trailing packets.
    await new Promise((r) => setTimeout(r, 120));
    recorder.stop();
    const blob = await done;
    return { blob, mimeType: mime };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Replace [startMs, endMs) with `replacement` blob (same sample clock after decode). */
export async function replaceAudioRange(
  original: Blob,
  startMs: number,
  endMs: number,
  replacement: Blob
): Promise<{ blob: Blob; mimeType: string }> {
  const lo = Math.max(0, Math.min(startMs, endMs));
  const hi = Math.max(startMs, endMs);
  const ctx = new AudioContext();
  try {
    const [origBuf, repBuf] = await Promise.all([
      ctx.decodeAudioData((await original.arrayBuffer()).slice(0)),
      ctx.decodeAudioData((await replacement.arrayBuffer()).slice(0)),
    ]);
    const rate = origBuf.sampleRate;
    const channels = Math.max(origBuf.numberOfChannels, repBuf.numberOfChannels);
    const startSample = Math.min(origBuf.length, Math.floor((lo / 1000) * rate));
    const endSample = Math.min(origBuf.length, Math.floor((hi / 1000) * rate));
    // Resample replacement length in original sample rate space (simple truncate/pad).
    const repLen = Math.floor((repBuf.duration) * rate);
    const total = startSample + repLen + Math.max(0, origBuf.length - endSample);
    const out = ctx.createBuffer(channels, Math.max(1, total), rate);

    for (let c = 0; c < channels; c++) {
      const dest = out.getChannelData(c);
      const o = origBuf.getChannelData(Math.min(c, origBuf.numberOfChannels - 1));
      const r = repBuf.getChannelData(Math.min(c, repBuf.numberOfChannels - 1));
      dest.set(o.subarray(0, startSample), 0);
      // Copy replacement (truncate/pad to repLen)
      for (let i = 0; i < repLen; i++) {
        dest[startSample + i] = i < r.length ? r[i]! : 0;
      }
      dest.set(o.subarray(endSample), startSample + repLen);
    }
    return encodeAudioBuffer(out);
  } finally {
    await ctx.close().catch(() => {});
  }
}
