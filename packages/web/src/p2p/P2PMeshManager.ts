import type { P2PSignalKind } from '@backspace/shared';
import { useP2PStore, type P2PPeerState, type P2PRouteKind } from '../stores/p2pStore';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const CTRL_CHANNEL_LABEL = 'balacopapo-ctrl';
const FILE_CHANNEL_LABEL = 'balacopapo-files';
const FILE_CHUNK_SIZE = 16 * 1024;
const HIGH_WATER_MARK = 256 * 1024;
const PING_INTERVAL_MS = 3_000;
const DEGRADED_RTT_MS = 350;
const CHANNEL_OPEN_TIMEOUT_MS = 18_000;

export interface IncomingP2PSignal {
  fromUserId: string;
  roomKey: string;
  kind: P2PSignalKind;
  payload?: string;
}

type SignalSender = (
  targetUserId: string,
  roomKey: string,
  kind: P2PSignalKind,
  payload?: string,
) => void;

interface IncomingFileOffer {
  id: string;
  peerUserId: string;
  fileName: string;
  mimeType: string;
  totalBytes: number;
}

interface IncomingFileBuffer {
  id: string;
  fileName: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  chunks: ArrayBuffer[];
}

interface PeerSession {
  userId: string;
  roomKey: string;
  polite: boolean;
  pc: RTCPeerConnection;
  ctrlChannel: RTCDataChannel | null;
  fileChannel: RTCDataChannel | null;
  makingOffer: boolean;
  pingTimer: ReturnType<typeof setInterval> | null;
  pendingPings: Map<number, number>;
  pendingIncomingOffers: Map<string, IncomingFileOffer>;
  incomingFiles: Map<string, IncomingFileBuffer>;
  activeIncomingFileId: string | null;
  rttMs: number | null;
  route: P2PRouteKind;
  fileChannelWaiters: Array<() => void>;
  pendingIceCandidates: RTCIceCandidateInit[];
}

/**
 * Hybrid P2P Mesh Manager (Phase 2A + 2B + survival/failover foundation for 2C).
 *
 * - Works both inside voice calls (automatic mesh for latency map) and on-demand
 *   in Direct Messages for consent-gated P2P file transfers.
 * - Mandatory receiver consent: sender transmits only a `file_offer` metadata
 *   frame first; zero file bytes leave the sender until the receiver explicitly
 *   clicks Accept (`file_accept`).
 */
export class P2PMeshManager {
  private static instance: P2PMeshManager | null = null;
  private sessions = new Map<string, PeerSession>();
  private pendingOutgoingFiles = new Map<string, { peerUserId: string; file: File }>();
  private myUserId: string | null = null;
  private currentRoomKey: string | null = null;
  private sendSignal: SignalSender | null = null;
  private pingSeq = 0;
  private transferSeq = 0;

  private constructor() {}

  static getInstance(): P2PMeshManager {
    if (!P2PMeshManager.instance) {
      P2PMeshManager.instance = new P2PMeshManager();
    }
    return P2PMeshManager.instance;
  }

  setLocalUserId(userId: string | null): void {
    this.myUserId = userId;
  }

  registerSignalSender(sender: SignalSender): void {
    this.sendSignal = sender;
  }

  /**
   * Synchronizes the mesh with the peers currently in the active voice room.
   * Direct DM file sessions (`roomKey.startsWith('dm:')`) are preserved until finished.
   */
  syncRoomPeers(myUserId: string, roomKey: string | null, remoteUserIds: string[]): void {
    this.myUserId = myUserId;
    const store = useP2PStore.getState();

    if (!store.enabled || !roomKey) {
      if (this.currentRoomKey !== null || store.activeRoomKey !== null) {
        this.leaveRoom();
      }
      return;
    }

    if (this.currentRoomKey && this.currentRoomKey !== roomKey) {
      this.leaveRoom();
    }

    this.currentRoomKey = roomKey;
    store.setActiveRoomKey(roomKey);

    const desired = new Set(remoteUserIds.filter((id) => id && id !== myUserId));

    for (const [peerId, session] of this.sessions) {
      if (session.roomKey === roomKey && !desired.has(peerId)) {
        this.closePeer(peerId, true);
      }
    }

    for (const peerId of desired) {
      if (!this.sessions.has(peerId)) {
        this.ensureSession(peerId, roomKey, true);
      }
    }
  }

  leaveRoom(): void {
    const prevRoom = this.currentRoomKey;
    for (const [peerId, session] of this.sessions) {
      if (!prevRoom || session.roomKey === prevRoom) {
        this.closePeer(peerId, true);
      }
    }
    this.currentRoomKey = null;
    useP2PStore.getState().setActiveRoomKey(null);
  }

  async handleIncomingSignal(signal: IncomingP2PSignal): Promise<void> {
    if (!useP2PStore.getState().enabled) return;
    if (!this.myUserId || signal.fromUserId === this.myUserId) return;

    if (signal.kind === 'bye') {
      const existing = this.sessions.get(signal.fromUserId);
      if (existing && existing.roomKey === signal.roomKey) {
        this.closePeer(signal.fromUserId, false);
      }
      return;
    }

    const session = this.ensureSession(signal.fromUserId, signal.roomKey, false);
    const { pc } = session;

    try {
      if (signal.kind === 'hello') {
        if (!session.polite && pc.signalingState === 'stable') {
          await this.createAndSendOffer(session);
        }
        return;
      }

      if (signal.kind === 'offer' && signal.payload) {
        const desc = JSON.parse(signal.payload) as RTCSessionDescriptionInit;
        const offerCollision = session.makingOffer || pc.signalingState !== 'stable';
        if (offerCollision && !session.polite) {
          return;
        }
        await pc.setRemoteDescription(desc);
        await this.flushPendingIceCandidates(session);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.emitSignal(session.userId, session.roomKey, 'answer', JSON.stringify(pc.localDescription));
        return;
      }

      if (signal.kind === 'answer' && signal.payload) {
        if (pc.signalingState !== 'have-local-offer') return;
        const desc = JSON.parse(signal.payload) as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(desc);
        await this.flushPendingIceCandidates(session);
        return;
      }

      if (signal.kind === 'ice' && signal.payload) {
        const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
        if (!pc.remoteDescription) {
          session.pendingIceCandidates.push(candidate);
          return;
        }
        await pc.addIceCandidate(candidate);
      }
    } catch (err) {
      console.warn(`[P2P] Signal (${signal.kind}) error with ${signal.fromUserId}:`, err);
    }
  }

  /**
   * Offers a file to a peer (establishing a direct DM P2P session on demand if needed).
   * Zero file bytes are sent until the receiver accepts the offer.
   */
  async sendFileToPeer(peerUserId: string, file: File, roomKey?: string): Promise<void> {
    if (!useP2PStore.getState().enabled) {
      throw new Error('P2P is disabled');
    }
    const effectiveRoomKey = roomKey ?? this.sessions.get(peerUserId)?.roomKey ?? this.currentRoomKey ?? `dm:${peerUserId}`;
    const existing = this.sessions.get(peerUserId);
    if (existing && existing.fileChannel?.readyState !== 'open' && existing.pc.connectionState !== 'connected') {
      // Stale/incomplete handshake from a prior attempt — start fresh so signaling re-fires.
      this.closePeer(peerUserId, false);
    }
    const session = this.ensureSession(peerUserId, effectiveRoomKey, true);
    const dc = await this.waitForFileChannel(session);

    const transferId = `${Date.now()}-${++this.transferSeq}`;
    this.pendingOutgoingFiles.set(transferId, { peerUserId, file });

    useP2PStore.getState().upsertTransfer({
      id: transferId,
      peerUserId,
      direction: 'send',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      totalBytes: file.size,
      transferredBytes: 0,
      status: 'pending_acceptance',
      createdAt: Date.now(),
    });

    dc.send(
      JSON.stringify({
        t: 'file_offer',
        id: transferId,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      }),
    );
  }

  /**
   * Receiver explicitly accepts a pending file offer, instructing the sender to begin streaming chunks.
   */
  acceptIncomingFile(transferId: string): void {
    for (const session of this.sessions.values()) {
      const offer = session.pendingIncomingOffers.get(transferId);
      if (!offer) continue;
      const dc = session.fileChannel;
      if (!dc || dc.readyState !== 'open') {
        useP2PStore.getState().failTransfer(transferId, 'P2P channel closed');
        session.pendingIncomingOffers.delete(transferId);
        return;
      }
      session.pendingIncomingOffers.delete(transferId);
      session.incomingFiles.set(transferId, {
        id: offer.id,
        fileName: offer.fileName,
        mimeType: offer.mimeType,
        totalBytes: offer.totalBytes,
        receivedBytes: 0,
        chunks: [],
      });
      session.activeIncomingFileId = transferId;
      useP2PStore.getState().setTransferStatus(transferId, 'transferring');
      dc.send(JSON.stringify({ t: 'file_accept', id: transferId }));
      return;
    }
  }

  /**
   * Receiver declines a pending file offer; notifies sender so no bytes are transmitted.
   */
  rejectIncomingFile(transferId: string): void {
    for (const session of this.sessions.values()) {
      if (!session.pendingIncomingOffers.has(transferId)) continue;
      session.pendingIncomingOffers.delete(transferId);
      if (session.fileChannel?.readyState === 'open') {
        session.fileChannel.send(JSON.stringify({ t: 'file_reject', id: transferId }));
      }
      useP2PStore.getState().setTransferStatus(transferId, 'rejected');
      return;
    }
  }

  private async streamAcceptedOutgoingFile(session: PeerSession, transferId: string): Promise<void> {
    const pending = this.pendingOutgoingFiles.get(transferId);
    const dc = session.fileChannel;
    if (!pending || !dc || dc.readyState !== 'open') return;

    this.pendingOutgoingFiles.delete(transferId);
    const { file } = pending;
    const store = useP2PStore.getState();
    store.setTransferStatus(transferId, 'transferring');

    try {
      dc.bufferedAmountLowThreshold = FILE_CHUNK_SIZE * 2;
      let offset = 0;
      while (offset < file.size) {
        if (dc.readyState !== 'open') {
          throw new Error('P2P connection closed mid-transfer');
        }
        if (dc.bufferedAmount > HIGH_WATER_MARK) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              dc.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            dc.addEventListener('bufferedamountlow', onLow);
          });
        }
        const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
        const buf = await slice.arrayBuffer();
        dc.send(buf);
        offset += buf.byteLength;
        store.updateTransferProgress(transferId, offset);
      }

      dc.send(JSON.stringify({ t: 'file_end', id: transferId }));
      store.completeTransfer(transferId);
    } catch (err) {
      store.failTransfer(transferId, err instanceof Error ? err.message : 'Transfer failed');
    }
  }

  private waitForFileChannel(session: PeerSession): Promise<RTCDataChannel> {
    if (session.fileChannel && session.fileChannel.readyState === 'open') {
      return Promise.resolve(session.fileChannel);
    }
    return new Promise<RTCDataChannel>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for direct P2P channel'));
      }, CHANNEL_OPEN_TIMEOUT_MS);

      session.fileChannelWaiters.push(() => {
        clearTimeout(timer);
        if (session.fileChannel && session.fileChannel.readyState === 'open') {
          resolve(session.fileChannel);
        } else {
          reject(new Error('P2P file channel unavailable'));
        }
      });
    });
  }

  private ensureSession(peerUserId: string, roomKey: string, initiateIfImpolite: boolean): PeerSession {
    const existing = this.sessions.get(peerUserId);
    if (existing && existing.pc.connectionState !== 'failed' && existing.pc.connectionState !== 'closed') {
      return existing;
    }
    if (existing) {
      this.closePeer(peerUserId, false);
    }

    const myId = this.myUserId ?? '';
    const polite = myId > peerUserId;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const session: PeerSession = {
      userId: peerUserId,
      roomKey,
      polite,
      pc,
      ctrlChannel: null,
      fileChannel: null,
      makingOffer: false,
      pingTimer: null,
      pendingPings: new Map(),
      pendingIncomingOffers: new Map(),
      incomingFiles: new Map(),
      activeIncomingFileId: null,
      rttMs: null,
      route: 'unknown',
      fileChannelWaiters: [],
      pendingIceCandidates: [],
    };

    this.sessions.set(peerUserId, session);
    this.publishPeerState(session, 'connecting');

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.emitSignal(peerUserId, roomKey, 'ice', JSON.stringify(e.candidate.toJSON()));
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        void this.refreshRouteStats(session);
        this.publishPeerState(session, this.computeHealthState(session));
      } else if (st === 'disconnected') {
        this.publishPeerState(session, 'degraded');
      } else if (st === 'failed') {
        this.publishPeerState(session, 'failed');
      } else if (st === 'closed') {
        this.publishPeerState(session, 'closed');
      }
    };

    pc.ondatachannel = (e) => {
      if (e.channel.label === CTRL_CHANNEL_LABEL) {
        this.attachCtrlChannel(session, e.channel);
      } else if (e.channel.label === FILE_CHANNEL_LABEL) {
        this.attachFileChannel(session, e.channel);
      }
    };

    if (!polite) {
      this.attachCtrlChannel(session, pc.createDataChannel(CTRL_CHANNEL_LABEL, { ordered: true }));
      this.attachFileChannel(session, pc.createDataChannel(FILE_CHANNEL_LABEL, { ordered: true }));
      if (initiateIfImpolite) {
        void this.createAndSendOffer(session);
      }
    } else if (initiateIfImpolite) {
      this.emitSignal(peerUserId, roomKey, 'hello');
    }

    return session;
  }

  private async flushPendingIceCandidates(session: PeerSession): Promise<void> {
    if (session.pendingIceCandidates.length === 0) return;
    const queued = session.pendingIceCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await session.pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn(`[P2P] Deferred ICE candidate error with ${session.userId}:`, err);
      }
    }
  }

  private async createAndSendOffer(session: PeerSession): Promise<void> {
    if (session.makingOffer) return;
    session.makingOffer = true;
    try {
      const offer = await session.pc.createOffer();
      await session.pc.setLocalDescription(offer);
      this.emitSignal(session.userId, session.roomKey, 'offer', JSON.stringify(session.pc.localDescription));
    } catch (err) {
      console.warn(`[P2P] Failed to create offer for ${session.userId}:`, err);
    } finally {
      session.makingOffer = false;
    }
  }

  private attachCtrlChannel(session: PeerSession, dc: RTCDataChannel): void {
    session.ctrlChannel = dc;
    dc.onopen = () => {
      void this.refreshRouteStats(session);
      this.publishPeerState(session, this.computeHealthState(session));
      this.startPingLoop(session);
    };
    dc.onclose = () => {
      if (session.pingTimer) {
        clearInterval(session.pingTimer);
        session.pingTimer = null;
      }
      this.publishPeerState(session, 'degraded');
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data) as { t: string; seq?: number };
        if (msg.t === 'ping' && typeof msg.seq === 'number') {
          if (dc.readyState === 'open') {
            dc.send(JSON.stringify({ t: 'pong', seq: msg.seq }));
          }
        } else if (msg.t === 'pong' && typeof msg.seq === 'number') {
          const sentAt = session.pendingPings.get(msg.seq);
          if (sentAt !== undefined) {
            session.pendingPings.delete(msg.seq);
            session.rttMs = Math.max(1, Math.round(performance.now() - sentAt));
            this.publishPeerState(session, this.computeHealthState(session));
          }
        }
      } catch {
        // Ignore malformed control frames
      }
    };
  }

  private attachFileChannel(session: PeerSession, dc: RTCDataChannel): void {
    session.fileChannel = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      this.publishPeerState(session, this.computeHealthState(session));
      const waiters = session.fileChannelWaiters.splice(0);
      for (const w of waiters) w();
    };
    dc.onmessage = (e) => {
      const store = useP2PStore.getState();
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data) as {
            t: string;
            id?: string;
            name?: string;
            mime?: string;
            size?: number;
          };
          if (msg.t === 'file_offer' && msg.id && msg.name && typeof msg.size === 'number') {
            session.pendingIncomingOffers.set(msg.id, {
              id: msg.id,
              peerUserId: session.userId,
              fileName: msg.name,
              mimeType: msg.mime || 'application/octet-stream',
              totalBytes: msg.size,
            });
            store.upsertTransfer({
              id: msg.id,
              peerUserId: session.userId,
              direction: 'receive',
              fileName: msg.name,
              mimeType: msg.mime || 'application/octet-stream',
              totalBytes: msg.size,
              transferredBytes: 0,
              status: 'pending_acceptance',
              createdAt: Date.now(),
            });
          } else if (msg.t === 'file_accept' && msg.id) {
            void this.streamAcceptedOutgoingFile(session, msg.id);
          } else if (msg.t === 'file_reject' && msg.id) {
            this.pendingOutgoingFiles.delete(msg.id);
            store.setTransferStatus(msg.id, 'rejected');
          } else if (msg.t === 'file_end' && msg.id) {
            const buf = session.incomingFiles.get(msg.id);
            if (buf) {
              const blob = new Blob(buf.chunks, { type: buf.mimeType });
              const url = URL.createObjectURL(blob);
              store.completeTransfer(msg.id, url);
              session.incomingFiles.delete(msg.id);
              if (session.activeIncomingFileId === msg.id) {
                session.activeIncomingFileId = null;
              }
            }
          }
        } catch {
          // Ignore malformed file metadata
        }
        return;
      }

      const appendBinaryChunk = (chunk: ArrayBuffer) => {
        if (!session.activeIncomingFileId) return;
        const buf = session.incomingFiles.get(session.activeIncomingFileId);
        if (!buf) return;
        buf.chunks.push(chunk);
        buf.receivedBytes += chunk.byteLength;
        store.updateTransferProgress(buf.id, buf.receivedBytes);
      };

      if (e.data instanceof ArrayBuffer) {
        appendBinaryChunk(e.data);
      } else if (e.data instanceof Blob) {
        void e.data.arrayBuffer().then(appendBinaryChunk);
      }
    };
  }

  private startPingLoop(session: PeerSession): void {
    if (session.pingTimer) clearInterval(session.pingTimer);
    const sendOne = () => {
      const dc = session.ctrlChannel;
      if (!dc || dc.readyState !== 'open') return;
      const seq = ++this.pingSeq;
      session.pendingPings.set(seq, performance.now());
      if (session.pendingPings.size > 10) {
        const oldest = session.pendingPings.keys().next().value;
        if (oldest !== undefined) session.pendingPings.delete(oldest);
      }
      try {
        dc.send(JSON.stringify({ t: 'ping', seq }));
      } catch {
        // Ignore transient send error
      }
    };
    sendOne();
    session.pingTimer = setInterval(sendOne, PING_INTERVAL_MS);
  }

  private async refreshRouteStats(session: PeerSession): Promise<void> {
    try {
      const stats = await session.pc.getStats();
      let selectedPairId: string | null = null;
      const candidates = new Map<string, string>();
      const pairs = new Map<string, { localCandidateId?: string; remoteCandidateId?: string; state?: string; nominated?: boolean }>();

      stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedPairId = report.selectedCandidatePairId as string;
        } else if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          if (report.candidateType) {
            candidates.set(report.id, report.candidateType as string);
          }
        } else if (report.type === 'candidate-pair') {
          pairs.set(report.id, {
            localCandidateId: report.localCandidateId as string | undefined,
            remoteCandidateId: report.remoteCandidateId as string | undefined,
            state: report.state as string | undefined,
            nominated: report.nominated as boolean | undefined,
          });
        }
      });

      const activePair =
        (selectedPairId ? pairs.get(selectedPairId) : null) ??
        Array.from(pairs.values()).find((p) => p.state === 'succeeded' && p.nominated);

      if (activePair) {
        const localType = activePair.localCandidateId ? candidates.get(activePair.localCandidateId) : undefined;
        const remoteType = activePair.remoteCandidateId ? candidates.get(activePair.remoteCandidateId) : undefined;
        if (localType === 'relay' || remoteType === 'relay') {
          session.route = 'relay';
        } else if (localType === 'host' && remoteType === 'host') {
          session.route = 'lan';
        } else if (localType || remoteType) {
          session.route = 'nat';
        }
      }
    } catch {
      // Ignore stats failure
    }
  }

  private computeHealthState(session: PeerSession): P2PPeerState {
    if (session.pc.connectionState === 'failed') return 'failed';
    if (session.pc.connectionState === 'closed') return 'closed';
    if (session.pc.connectionState === 'disconnected') return 'degraded';
    if (session.rttMs !== null && session.rttMs > DEGRADED_RTT_MS) return 'degraded';
    if (session.ctrlChannel?.readyState === 'open' || session.pc.connectionState === 'connected') {
      return 'connected';
    }
    return 'connecting';
  }

  private publishPeerState(session: PeerSession, state: P2PPeerState): void {
    useP2PStore.getState().upsertPeer({
      userId: session.userId,
      roomKey: session.roomKey,
      state,
      rttMs: session.rttMs,
      route: session.route,
      dataChannelReady: session.fileChannel?.readyState === 'open',
      lastUpdatedAt: Date.now(),
    });
  }

  private closePeer(peerUserId: string, notifyRemote: boolean): void {
    const session = this.sessions.get(peerUserId);
    if (!session) return;
    this.sessions.delete(peerUserId);
    if (session.pingTimer) {
      clearInterval(session.pingTimer);
      session.pingTimer = null;
    }
    if (notifyRemote) {
      this.emitSignal(peerUserId, session.roomKey, 'bye');
    }
    try { session.ctrlChannel?.close(); } catch { /* ignore */ }
    try { session.fileChannel?.close(); } catch { /* ignore */ }
    try { session.pc.close(); } catch { /* ignore */ }
    useP2PStore.getState().removePeer(peerUserId);
  }

  private emitSignal(targetUserId: string, roomKey: string, kind: P2PSignalKind, payload?: string): void {
    this.sendSignal?.(targetUserId, roomKey, kind, payload);
  }
}
