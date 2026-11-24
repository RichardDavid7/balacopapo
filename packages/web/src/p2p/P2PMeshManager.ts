import type { P2PSignalKind } from '@backspace/shared';
import { useP2PStore, type P2PPeerState, type P2PRouteKind } from '../stores/p2pStore';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const CTRL_CHANNEL_LABEL = 'balacopapo-ctrl';
const FILE_CHANNEL_LABEL = 'balacopapo-files';
const FILE_CHUNK_SIZE = 64 * 1024; // 64 KB chunks for smooth WebRTC DataChannel flow
const HIGH_WATER_MARK = 512 * 1024;
const PING_INTERVAL_MS = 3_000;
const DEGRADED_RTT_MS = 350;

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
  incomingFiles: Map<string, IncomingFileBuffer>;
  activeIncomingFileId: string | null;
  rttMs: number | null;
  route: P2PRouteKind;
}

/**
 * Hybrid P2P Mesh Manager (Phase 2A + 2B + survival/failover foundation for 2C).
 *
 * - Establishes direct WebRTC RTCPeerConnections with peers in the same room
 *   using glare-free polite/impolite negotiation (`myUserId < remoteUserId`).
 * - Measures direct peer RTT every 3s over an ordered control DataChannel and
 *   inspects ICE candidate-pair stats (`lan` / `nat` / `relay`).
 * - Streams direct P2P file transfers in 64 KB chunks over a dedicated DataChannel
 *   without touching server bandwidth.
 * - Survives temporary server/WS drops once connected; marks degraded/failed
 *   links so hybrid call routing can fail over to LiveKit automatically.
 */
export class P2PMeshManager {
  private static instance: P2PMeshManager | null = null;
  private sessions = new Map<string, PeerSession>();
  private myUserId: string | null = null;
  private currentRoomKey: string | null = null;
  private sendSignal: SignalSender | null = null;
  private pingSeq = 0;

  private constructor() {}

  static getInstance(): P2PMeshManager {
    if (!P2PMeshManager.instance) {
      P2PMeshManager.instance = new P2PMeshManager();
    }
    return P2PMeshManager.instance;
  }

  registerSignalSender(sender: SignalSender): void {
    this.sendSignal = sender;
  }

  /**
   * Synchronizes the mesh with the peers currently in the active voice room.
   * Existing healthy P2P links stay open even if the signaling WS drops later.
   */
  syncRoomPeers(myUserId: string, roomKey: string | null, remoteUserIds: string[]): void {
    this.myUserId = myUserId;
    const store = useP2PStore.getState();

    if (!store.enabled || !roomKey) {
      if (this.sessions.size > 0 || store.activeRoomKey !== null) {
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

    // Close sessions for peers that left the room
    for (const [peerId] of this.sessions) {
      if (!desired.has(peerId)) {
        this.closePeer(peerId, true);
      }
    }

    // Ensure a P2P session exists for every peer in the room
    for (const peerId of desired) {
      if (!this.sessions.has(peerId)) {
        this.ensureSession(peerId, roomKey, true);
      }
    }
  }

  leaveRoom(): void {
    for (const [peerId] of this.sessions) {
      this.closePeer(peerId, true);
    }
    this.currentRoomKey = null;
    useP2PStore.getState().clearPeers();
  }

  async handleIncomingSignal(signal: IncomingP2PSignal): Promise<void> {
    if (!useP2PStore.getState().enabled) return;
    if (!this.myUserId || signal.fromUserId === this.myUserId) return;
    if (this.currentRoomKey && signal.roomKey !== this.currentRoomKey) return;

    if (signal.kind === 'bye') {
      this.closePeer(signal.fromUserId, false);
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
          return; // Impolite peer ignores colliding offer
        }
        await pc.setRemoteDescription(desc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.emitSignal(session.userId, session.roomKey, 'answer', JSON.stringify(pc.localDescription));
        return;
      }

      if (signal.kind === 'answer' && signal.payload) {
        if (pc.signalingState !== 'have-local-offer') return;
        const desc = JSON.parse(signal.payload) as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(desc);
        return;
      }

      if (signal.kind === 'ice' && signal.payload) {
        const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
        await pc.addIceCandidate(candidate);
      }
    } catch (err) {
      console.warn(`[P2P] Signal (${signal.kind}) error with ${signal.fromUserId}:`, err);
    }
  }

  /**
   * Sends a File directly to a connected P2P peer over the dedicated DataChannel.
   */
  async sendFileToPeer(peerUserId: string, file: File): Promise<void> {
    const session = this.sessions.get(peerUserId);
    const dc = session?.fileChannel;
    if (!session || !dc || dc.readyState !== 'open') {
      throw new Error('P2P file channel is not open for this peer');
    }

    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const store = useP2PStore.getState();
    store.upsertTransfer({
      id: transferId,
      peerUserId,
      direction: 'send',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      totalBytes: file.size,
      transferredBytes: 0,
      status: 'transferring',
      createdAt: Date.now(),
    });

    try {
      dc.bufferedAmountLowThreshold = FILE_CHUNK_SIZE * 2;
      dc.send(
        JSON.stringify({
          t: 'file_start',
          id: transferId,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
        }),
      );

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
      throw err;
    }
  }

  private ensureSession(peerUserId: string, roomKey: string, initiateIfImpolite: boolean): PeerSession {
    const existing = this.sessions.get(peerUserId);
    if (existing) return existing;

    const myId = this.myUserId ?? '';
    const polite = myId > peerUserId; // Deterministic glare resolution
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
      incomingFiles: new Map(),
      activeIncomingFileId: null,
      rttMs: null,
      route: 'unknown',
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
      // Impolite peer creates both DataChannels and sends the initial offer
      this.attachCtrlChannel(session, pc.createDataChannel(CTRL_CHANNEL_LABEL, { ordered: true }));
      this.attachFileChannel(session, pc.createDataChannel(FILE_CHANNEL_LABEL, { ordered: true }));
      if (initiateIfImpolite) {
        void this.createAndSendOffer(session);
      }
    } else if (initiateIfImpolite) {
      // Polite peer announces presence so impolite peer starts negotiation
      this.emitSignal(peerUserId, roomKey, 'hello');
    }

    return session;
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
          if (msg.t === 'file_start' && msg.id && msg.name && typeof msg.size === 'number') {
            session.incomingFiles.set(msg.id, {
              id: msg.id,
              fileName: msg.name,
              mimeType: msg.mime || 'application/octet-stream',
              totalBytes: msg.size,
              receivedBytes: 0,
              chunks: [],
            });
            session.activeIncomingFileId = msg.id;
            store.upsertTransfer({
              id: msg.id,
              peerUserId: session.userId,
              direction: 'receive',
              fileName: msg.name,
              mimeType: msg.mime || 'application/octet-stream',
              totalBytes: msg.size,
              transferredBytes: 0,
              status: 'transferring',
              createdAt: Date.now(),
            });
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

      if (e.data instanceof ArrayBuffer && session.activeIncomingFileId) {
        const buf = session.incomingFiles.get(session.activeIncomingFileId);
        if (!buf) return;
        buf.chunks.push(e.data);
        buf.receivedBytes += e.data.byteLength;
        store.updateTransferProgress(buf.id, buf.receivedBytes);
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
      // Trim stale pings
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
