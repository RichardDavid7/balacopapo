import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { useP2PStore, type P2PPeerInfo } from '../../stores/p2pStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { P2PMeshManager } from '../../p2p/P2PMeshManager';
import { wsSend } from '../../hooks/useWebSocket';
import { useUIStore } from '../../stores/uiStore';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rttColor(rttMs: number | null): string {
  if (rttMs === null) return '#94a3b8';
  if (rttMs < 40) return '#34d399';
  if (rttMs < 120) return '#fbbf24';
  return '#f43f5e';
}

/**
 * Keeps P2PMeshManager synchronized with the active voice room participants
 * and periodically measures HTTP RTT to the instance for the Mesh Map.
 */
export function useP2PMeshSync(): void {
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const participants = useVoiceStore((s) => s.participants);
  const p2pEnabled = useP2PStore((s) => s.enabled);

  useEffect(() => {
    const manager = P2PMeshManager.getInstance();
    manager.registerSignalSender((targetUserId, roomKey, kind, payload) => {
      wsSend({ type: 'p2p_signal', targetUserId, roomKey, kind, payload });
    });
  }, []);

  useEffect(() => {
    const manager = P2PMeshManager.getInstance();
    const roomKey = currentVoiceChannelId
      ? `ch:${currentVoiceChannelId}`
      : activeDmCall
        ? `dm:${activeDmCall.dmChannelId}`
        : null;

    if (!myUserId || !roomKey || !p2pEnabled) {
      manager.leaveRoom();
      return;
    }

    const remoteIds = participants
      .filter((p) => !p.isLocal && p.userId)
      .map((p) => p.userId);
    manager.syncRoomPeers(myUserId, roomKey, remoteIds);
  }, [myUserId, currentVoiceChannelId, activeDmCall, participants, p2pEnabled]);

  useEffect(() => {
    if (!currentVoiceChannelId && !activeDmCall) {
      useP2PStore.getState().setInstanceRttMs(null);
      return;
    }
    let cancelled = false;
    const probe = async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/health', { cache: 'no-store' });
        if (!cancelled) {
          useP2PStore.getState().setInstanceRttMs(Math.max(1, Math.round(performance.now() - t0)));
        }
      } catch {
        if (!cancelled) {
          useP2PStore.getState().setInstanceRttMs(null);
        }
      }
    };
    void probe();
    const timer = setInterval(() => { void probe(); }, 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentVoiceChannelId, activeDmCall]);
}

/**
 * Compact P2P indicator badge placed in VoiceControls.
 * Shows connected direct peer count + best RTT and opens the P2P Mesh Map modal.
 */
export function P2PStatusButton() {
  const { t } = useTranslation(['voice', 'common']);
  const enabled = useP2PStore((s) => s.enabled);
  const peersMap = useP2PStore((s) => s.peers);
  const transfers = useP2PStore((s) => s.transfers);
  const setMeshModalOpen = useP2PStore((s) => s.setMeshModalOpen);

  useP2PMeshSync();

  const peers = Object.values(peersMap);
  const connectedPeers = peers.filter((p) => p.state === 'connected');
  const activeTransfers = transfers.filter((tr) => tr.status === 'transferring').length;
  const bestRtt = connectedPeers.reduce<number | null>(
    (min, p) => (p.rttMs !== null && (min === null || p.rttMs < min) ? p.rttMs : min),
    null,
  );

  return (
    <button
      type="button"
      onClick={() => setMeshModalOpen(true)}
      title={t('voice:p2p.openMeshTitle')}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
        !enabled
          ? 'bg-white/[0.04] text-txt-tertiary hover:text-txt-secondary'
          : connectedPeers.length > 0
            ? 'bg-accent-mint/15 text-accent-mint hover:bg-accent-mint/25'
            : 'bg-white/[0.06] text-txt-secondary hover:bg-white/[0.10]'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          !enabled
            ? 'bg-txt-tertiary/50'
            : connectedPeers.length > 0
              ? 'bg-accent-mint'
              : 'bg-accent-amber'
        }`}
      />
      {/* i18n-check: allow-literal "P2P" is the protocol acronym */}
      <span>P2P</span>
      {connectedPeers.length > 0 && (
        <span className="tabular-nums opacity-90">
          {connectedPeers.length}
          {bestRtt !== null ? ` · ${t('common:units.ms', { value: bestRtt })}` : ''}
        </span>
      )}
      {activeTransfers > 0 && (
        <span className="px-1 rounded bg-accent-primary text-white text-[9px] tabular-nums">
          {activeTransfers}
        </span>
      )}
    </button>
  );
}

export function P2PMeshModal() {
  const { t } = useTranslation(['voice', 'common']);
  const isOpen = useP2PStore((s) => s.meshModalOpen);
  const setOpen = useP2PStore((s) => s.setMeshModalOpen);
  const enabled = useP2PStore((s) => s.enabled);
  const setEnabled = useP2PStore((s) => s.setEnabled);
  const peersMap = useP2PStore((s) => s.peers);
  const transfers = useP2PStore((s) => s.transfers);
  const instanceRttMs = useP2PStore((s) => s.instanceRttMs);
  const clearCompletedTransfers = useP2PStore((s) => s.clearCompletedTransfers);
  const members = useSpaceStore((s) => s.members);
  const addToast = useUIStore((s) => s.addToast);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetPeerId, setTargetPeerId] = useState<string | null>(null);

  if (!isOpen) return null;

  const peers = Object.values(peersMap);

  const resolvePeerName = (userId: string): string => {
    const member = members.find((m) => m.userId === userId);
    return member?.nickname || member?.user.displayName || member?.user.username || userId.slice(0, 8);
  };

  const handlePickFile = (peerId: string) => {
    setTargetPeerId(peerId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !targetPeerId) return;
    try {
      await P2PMeshManager.getInstance().sendFileToPeer(targetPeerId, file);
      addToast(t('voice:p2p.transferSent', { name: file.name }), 'success', 2500);
    } catch {
      addToast(t('voice:p2p.transferFailed'), 'warning', 3000);
    }
  };

  // Layout coordinates for the SVG Mesh Graph (360 x 210)
  const cx = 180;
  const cy = 115;
  const instX = 180;
  const instY = 28;
  const radius = 78;

  const peerNodes = peers.map((peer, idx) => {
    const angle = peers.length === 1
      ? Math.PI / 2
      : (Math.PI * 0.15) + (idx / Math.max(1, peers.length - 1)) * (Math.PI * 0.7);
    return {
      peer,
      x: cx + Math.cos(angle) * radius * 1.4,
      y: cy + Math.sin(angle) * radius * 0.85,
    };
  });

  const routeLabel = (route: P2PPeerInfo['route']) => {
    if (route === 'lan') return 'LAN';
    if (route === 'nat') return 'NAT';
    if (route === 'relay') return 'Relay';
    return '—';
  };

  return (
    <Modal isOpen={isOpen} onClose={() => setOpen(false)} title={t('voice:p2p.modalTitle')} maxWidth="max-w-lg">
      <div className="space-y-4">
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />

        {/* Toggle + status header */}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3.5 py-2.5">
          <div>
            <div className="text-sm font-medium text-txt-primary">{t('voice:p2p.enableLabel')}</div>
            <div className="text-xs text-txt-tertiary">{t('voice:p2p.enableDescription')}</div>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              enabled
                ? 'bg-accent-primary text-white hover:bg-accent-primary-hover'
                : 'bg-surface-base text-txt-secondary hover:text-txt-primary'
            }`}
          >
            {enabled ? t('voice:p2p.statusOn') : t('voice:p2p.statusOff')}
          </button>
        </div>

        {/* Visual Mesh Graph (Phase 2B) */}
        <div className="rounded-lg bg-surface-base border border-white/[0.06] p-3">
          <svg viewBox="0 0 360 210" className="w-full h-[200px]">
            {/* Link: You -> Instance */}
            <line
              x1={cx}
              y1={cy}
              x2={instX}
              y2={instY}
              stroke={rttColor(instanceRttMs)}
              strokeWidth={2}
              strokeDasharray="4 3"
              opacity={0.75}
            />
            <text x={cx + 8} y={(cy + instY) / 2} fill={rttColor(instanceRttMs)} fontSize="10" fontWeight="600">
              {instanceRttMs !== null ? t('common:units.ms', { value: instanceRttMs }) : '—'}
            </text>

            {/* Direct links: You -> Peers */}
            {peerNodes.map(({ peer, x, y }) => (
              <g key={`link-${peer.userId}`}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  stroke={peer.state === 'connected' ? rttColor(peer.rttMs) : '#64748b'}
                  strokeWidth={peer.state === 'connected' ? 2.5 : 1.5}
                  strokeDasharray={peer.state === 'connected' ? undefined : '3 3'}
                />
                <text
                  x={(cx + x) / 2}
                  y={(cy + y) / 2 - 4}
                  textAnchor="middle"
                  fill={peer.state === 'connected' ? rttColor(peer.rttMs) : '#94a3b8'}
                  fontSize="10"
                  fontWeight="600"
                >
                  {peer.rttMs !== null ? t('common:units.ms', { value: peer.rttMs }) : peer.state}
                </text>
              </g>
            ))}

            {/* Instance Node */}
            <rect x={instX - 44} y={instY - 14} width={88} height={26} rx={6} fill="#1e293b" stroke="#475569" />
            <text x={instX} y={instY + 3} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="600">
              {t('voice:p2p.instanceNode')}
            </text>

            {/* Local User Node */}
            <circle cx={cx} cy={cy} r={20} fill="#7c3aed" stroke="#c4b5fd" strokeWidth={2} />
            <text x={cx} y={cy + 4} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">
              {t('voice:p2p.youNode')}
            </text>

            {/* Remote Peer Nodes */}
            {peerNodes.map(({ peer, x, y }) => (
              <g key={`node-${peer.userId}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={17}
                  fill={peer.state === 'connected' ? '#065f46' : '#334155'}
                  stroke={peer.state === 'connected' ? '#34d399' : '#64748b'}
                  strokeWidth={2}
                />
                <text x={x} y={y + 3} textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">
                  {resolvePeerName(peer.userId).slice(0, 6)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Peer list + Direct P2P file send (Phase 2A) */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
            {t('voice:p2p.peersHeading')}
          </div>
          {peers.length === 0 ? (
            <div className="text-xs text-txt-tertiary py-2">{t('voice:p2p.noPeers')}</div>
          ) : (
            peers.map((peer) => (
              <div
                key={peer.userId}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] border border-white/[0.05] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-txt-primary truncate">{resolvePeerName(peer.userId)}</div>
                  <div className="text-[11px] text-txt-tertiary flex items-center gap-2 tabular-nums">
                    <span>{peer.state}</span>
                    <span>·</span>
                    <span>{routeLabel(peer.route)}</span>
                    {peer.rttMs !== null && (
                      <>
                        <span>·</span>
                        <span>{t('common:units.ms', { value: peer.rttMs })}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!peer.dataChannelReady}
                  onClick={() => handlePickFile(peer.userId)}
                  className="flex-shrink-0 px-2.5 py-1.5 rounded bg-accent-primary hover:bg-accent-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                >
                  {t('voice:p2p.sendFile')}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Active & completed P2P transfers */}
        {transfers.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
                {t('voice:p2p.transfersHeading')}
              </div>
              <button
                type="button"
                onClick={clearCompletedTransfers}
                className="text-[11px] text-txt-tertiary hover:text-txt-primary"
              >
                {t('common:actions.clear')}
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {transfers.map((tr) => {
                const pct = tr.totalBytes > 0 ? Math.min(100, Math.round((tr.transferredBytes / tr.totalBytes) * 100)) : 100;
                return (
                  <div key={tr.id} className="rounded-md bg-white/[0.03] border border-white/[0.05] px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-txt-primary truncate">{tr.fileName}</span>
                      <span className="text-txt-tertiary tabular-nums flex-shrink-0">
                        {formatBytes(tr.totalBytes)} · {pct}%
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-surface-base mt-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all ${tr.status === 'failed' ? 'bg-accent-rose' : 'bg-accent-mint'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {tr.status === 'completed' && tr.direction === 'receive' && tr.downloadUrl && (
                      <a
                        href={tr.downloadUrl}
                        download={tr.fileName}
                        className="inline-block mt-1.5 text-accent-primary hover:underline font-medium"
                      >
                        {t('voice:p2p.downloadFile')}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
