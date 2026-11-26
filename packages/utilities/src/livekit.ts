import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { CHANNELS, SAMPLES_PER_FRAME, SAMPLE_RATE } from './audio.js';

/** Destino de áudio PCM (abstraído para facilitar testes). */
export interface AudioSink {
  push(frame: Int16Array): Promise<void>;
  /** Aguarda o áudio enfileirado terminar de tocar. */
  drain(): Promise<void>;
  /** Descarta áudio pendente (skip/stop). */
  clear(): void;
}

export class LiveKitVoice implements AudioSink {
  private room: Room | null = null;
  private source: AudioSource | null = null;

  get connected(): boolean {
    return this.room !== null;
  }

  async connect(url: string, token: string): Promise<void> {
    const room = new Room();
    await room.connect(url, token, { autoSubscribe: false, dynacast: false });
    const source = new AudioSource(SAMPLE_RATE, CHANNELS, 1000);
    const track = LocalAudioTrack.createAudioTrack('music', source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant?.publishTrack(track, opts);
    this.room = room;
    this.source = source;
  }

  async push(frame: Int16Array): Promise<void> {
    if (!this.source) throw new Error('LiveKit não conectado');
    await this.source.captureFrame(new AudioFrame(frame, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME));
  }

  async drain(): Promise<void> {
    await this.source?.waitForPlayout();
  }

  clear(): void {
    this.source?.clearQueue();
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.source = null;
    await room?.disconnect();
  }
}
