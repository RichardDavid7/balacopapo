import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type P2PPeerState = 'connecting' | 'connected' | 'degraded' | 'failed' | 'closed';
export type P2PRouteKind = 'lan' | 'nat' | 'relay' | 'unknown';
export type P2PTransferStatus =
  | 'pending_acceptance'
  | 'transferring'
  | 'completed'
  | 'rejected'
  | 'failed';

export interface P2PPeerInfo {
  userId: string;
  roomKey: string;
  state: P2PPeerState;
  rttMs: number | null;
  route: P2PRouteKind;
  dataChannelReady: boolean;
  lastUpdatedAt: number;
}

export interface P2PFileTransfer {
  id: string;
  peerUserId: string;
  direction: 'send' | 'receive';
  fileName: string;
  mimeType: string;
  totalBytes: number;
  transferredBytes: number;
  status: P2PTransferStatus;
  downloadUrl?: string;
  error?: string;
  createdAt: number;
}

interface P2PState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  activeRoomKey: string | null;
  instanceRttMs: number | null;
  peers: Record<string, P2PPeerInfo>;
  transfers: P2PFileTransfer[];
  meshModalOpen: boolean;

  setMeshModalOpen: (open: boolean) => void;
  setActiveRoomKey: (roomKey: string | null) => void;
  setInstanceRttMs: (rttMs: number | null) => void;
  upsertPeer: (peer: P2PPeerInfo) => void;
  removePeer: (userId: string) => void;
  clearPeers: () => void;
  upsertTransfer: (transfer: P2PFileTransfer) => void;
  setTransferStatus: (id: string, status: P2PTransferStatus, error?: string) => void;
  updateTransferProgress: (id: string, transferredBytes: number) => void;
  completeTransfer: (id: string, downloadUrl?: string) => void;
  failTransfer: (id: string, error: string) => void;
  dismissTransfer: (id: string) => void;
  clearCompletedTransfers: () => void;
}

export const useP2PStore = create<P2PState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      activeRoomKey: null,
      instanceRttMs: null,
      peers: {},
      transfers: [],
      meshModalOpen: false,

      setMeshModalOpen: (meshModalOpen) => set({ meshModalOpen }),
      setActiveRoomKey: (activeRoomKey) => set({ activeRoomKey }),
      setInstanceRttMs: (instanceRttMs) => set({ instanceRttMs }),
      upsertPeer: (peer) =>
        set((s) => ({
          peers: { ...s.peers, [peer.userId]: peer },
        })),
      removePeer: (userId) =>
        set((s) => {
          const next = { ...s.peers };
          delete next[userId];
          return { peers: next };
        }),
      clearPeers: () => set({ peers: {}, activeRoomKey: null }),
      upsertTransfer: (transfer) =>
        set((s) => ({
          transfers: [transfer, ...s.transfers.filter((t) => t.id !== transfer.id)].slice(0, 30),
        })),
      setTransferStatus: (id, status, error) =>
        set((s) => ({
          transfers: s.transfers.map((t) =>
            t.id === id ? { ...t, status, error: error ?? t.error } : t,
          ),
        })),
      updateTransferProgress: (id, transferredBytes) =>
        set((s) => ({
          transfers: s.transfers.map((t) =>
            t.id === id ? { ...t, transferredBytes } : t,
          ),
        })),
      completeTransfer: (id, downloadUrl) =>
        set((s) => ({
          transfers: s.transfers.map((t) =>
            t.id === id
              ? { ...t, status: 'completed', transferredBytes: t.totalBytes, downloadUrl: downloadUrl ?? t.downloadUrl }
              : t,
          ),
        })),
      failTransfer: (id, error) =>
        set((s) => ({
          transfers: s.transfers.map((t) =>
            t.id === id ? { ...t, status: 'failed', error } : t,
          ),
        })),
      dismissTransfer: (id) =>
        set((s) => {
          const target = s.transfers.find((t) => t.id === id);
          if (target?.downloadUrl) URL.revokeObjectURL(target.downloadUrl);
          return { transfers: s.transfers.filter((t) => t.id !== id) };
        }),
      clearCompletedTransfers: () =>
        set((s) => {
          for (const t of s.transfers) {
            if (t.status !== 'transferring' && t.status !== 'pending_acceptance' && t.downloadUrl) {
              URL.revokeObjectURL(t.downloadUrl);
            }
          }
          return {
            transfers: s.transfers.filter(
              (t) => t.status === 'transferring' || t.status === 'pending_acceptance',
            ),
          };
        }),
    }),
    {
      name: 'balacopapo-p2p-prefs',
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);
