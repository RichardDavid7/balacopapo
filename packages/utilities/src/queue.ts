import type { MusicLoopMode, MusicTrack } from '@backspace/shared';

/**
 * Espelho local da fila do servidor. O servidor é quem aplica comandos de usuário
 * (play/skip/stop...) e nos entrega via polling; aqui reproduzimos a mesma lógica
 * para que o bot avance sozinho quando uma faixa termina.
 */
export class TrackQueue {
  current: MusicTrack | null = null;
  queue: MusicTrack[] = [];
  loopMode: MusicLoopMode = 'off';

  /** Retorna true se a faixa começou a tocar imediatamente. */
  add(track: MusicTrack): boolean {
    if (this.current?.id === track.id || this.queue.some((t) => t.id === track.id)) return false;
    if (!this.current) {
      this.current = track;
      return true;
    }
    this.queue.push(track);
    return false;
  }

  /** Avança para a próxima faixa. `preferredId` vem do servidor (`nextTrackId`). */
  advance(preferredId?: string): MusicTrack | null {
    const previous = this.current;
    if (this.loopMode === 'queue' && previous) this.queue.push(previous);

    let next: MusicTrack | null = null;
    if (preferredId) {
      const idx = this.queue.findIndex((t) => t.id === preferredId);
      if (idx >= 0) next = this.queue.splice(idx, 1)[0] ?? null;
    }
    next ??= this.queue.shift() ?? null;
    this.current = next;
    return next;
  }

  /** Chamado quando a faixa atual termina naturalmente. */
  onTrackEnded(): MusicTrack | null {
    if (this.loopMode === 'track' && this.current) return this.current;
    return this.advance();
  }

  remove(trackId: string): void {
    this.queue = this.queue.filter((t) => t.id !== trackId);
  }

  clear(): void {
    this.queue = [];
  }

  stop(): void {
    this.current = null;
    this.queue = [];
  }
}
