import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * Bootstraps P2PMeshManager signaling globally as soon as the user is authenticated,
 * so direct DM file offers can arrive even when the user is not in a voice call.
 */
export function useP2PGlobalBridge(): void {
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const manager = P2PMeshManager.getInstance();
    manager.setLocalUserId(myUserId);
    manager.registerSignalSender((targetUserId, roomKey, kind, payload) => {
      wsSend({ type: 'p2p_signal', targetUserId, roomKey, kind, payload });
    });
  }, [myUserId]);
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

  useP2PGlobalBridge();

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
  const setMeshModalOpen = useP2PStore((s) => s.setMeshModalOpen);

  useP2PMeshSync();

  const peers = Object.values(peersMap);
  const connectedPeers = peers.filter((p) => p.state === 'connected');
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
    </button>
  );
}

/**
 * Direct-Message header action button to offer a P2P file directly to the DM partner.
 * The recipient must explicitly accept before any file bytes are transmitted.
 */
export function DmP2PSendButton({
  peerUserId,
  dmChannelId,
  variant = 'header',
}: {
  peerUserId: string;
  dmChannelId: string;
  variant?: 'header' | 'composer';
}) {
  const { t } = useTranslation(['voice']);
  const enabled = useP2PStore((s) => s.enabled);
  const addToast = useUIStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!enabled) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await P2PMeshManager.getInstance().sendFileToPeer(peerUserId, file, `dm:${dmChannelId}`);
      addToast(t('voice:p2p.offerSent', { name: file.name }), 'info', 2500);
    } catch {
      addToast(t('voice:p2p.transferFailed'), 'warning', 3000);
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'composer') {
    return (
      <>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          title={t('voice:p2p.sendFileDmTitle')}
          aria-label={t('voice:p2p.sendFileDmTitle')}
          className="h-8 desktop:h-[28px] px-2 mr-1 inline-flex items-center gap-1 rounded-[6px] bg-accent-mint/10 hover:bg-accent-mint/20 border border-accent-mint/25 text-accent-mint text-[11px] font-semibold transition-colors flex-shrink-0 disabled:opacity-50"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          {/* i18n-check: allow-literal "P2P" is the protocol acronym */}
          <span>P2P</span>
        </button>
      </>
    );
  }

  return (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
        title={t('voice:p2p.sendFileDmTitle')}
        aria-label={t('voice:p2p.sendFileDmTitle')}
        className="h-7 px-2 inline-flex items-center gap-1 text-accent-mint bg-accent-mint/10 hover:bg-accent-mint/20 border border-accent-mint/25 text-[11px] font-semibold transition-colors rounded-[6px] disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
        {/* i18n-check: allow-literal "P2P" is the protocol acronym */}
        <span>P2P</span>
      </button>
    </>
  );
}

/**
 * Global floating tray for consent-gated P2P file offers and active transfers.
 * Renders Accept / Reject buttons for incoming offers before any bytes are transferred.
 */
export function P2PTransferTray() {
  const { t } = useTranslation(['voice', 'common']);
  const transfers = useP2PStore((s) => s.transfers);
  const dismissTransfer = useP2PStore((s) => s.dismissTransfer);
  const members = useSpaceStore((s) => s.members);
  const dmChannels = useSpaceStore((s) => s.dmChannels);

  useP2PGlobalBridge();

  if (transfers.length === 0) return null;

  const resolveName = (userId: string): string => {
    const member = members.find((m) => m.userId === userId);
    if (member) return member.nickname || member.user.displayName || member.user.username;
    for (const dm of dmChannels) {
      const u = dm.members?.find((m) => m.id === userId);
      if (u) return u.displayName || u.username;
    }
    return userId.slice(0, 8);
  };

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[9990] w-80 max-w-[calc(var(--vw)*100-2rem)] space-y-2 pointer-events-auto">
      {transfers.slice(0, 4).map((tr) => {
        const pct = tr.totalBytes > 0 ? Math.min(100, Math.round((tr.transferredBytes / tr.totalBytes) * 100)) : 100;
        const peerName = resolveName(tr.peerUserId);
        return (
          <div
            key={tr.id}
            className="rounded-xl bg-surface-elevated border border-white/10 shadow-elevation-high p-3 text-xs space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-txt-primary truncate">{tr.fileName}</div>
                <div className="text-[11px] text-txt-tertiary truncate">
                  {tr.direction === 'receive'
                    ? t('voice:p2p.incomingFrom', { name: peerName, size: formatBytes(tr.totalBytes) })
                    : t('voice:p2p.outgoingTo', { name: peerName, size: formatBytes(tr.totalBytes) })}
                </div>
              </div>
              {tr.status !== 'transferring' && (
                <button
                  type="button"
                  onClick={() => dismissTransfer(tr.id)}
                  aria-label={t('common:actions.close')}
                  className="text-txt-tertiary hover:text-txt-primary px-1"
                >
                  ×
                </button>
              )}
            </div>

            {tr.status === 'pending_acceptance' && tr.direction === 'receive' && (
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => P2PMeshManager.getInstance().acceptIncomingFile(tr.id)}
                  className="flex-1 py-1.5 rounded bg-accent-mint/20 hover:bg-accent-mint/30 text-accent-mint font-semibold transition-colors"
                >
                  {t('voice:p2p.accept')}
                </button>
                <button
                  type="button"
                  onClick={() => P2PMeshManager.getInstance().rejectIncomingFile(tr.id)}
                  className="flex-1 py-1.5 rounded bg-accent-rose/15 hover:bg-accent-rose/25 text-accent-rose font-semibold transition-colors"
                >
                  {t('voice:p2p.reject')}
                </button>
              </div>
            )}

            {tr.status === 'pending_acceptance' && tr.direction === 'send' && (
              <div className="text-[11px] text-accent-amber">{t('voice:p2p.waitingAcceptance')}</div>
            )}

            {tr.status === 'transferring' && (
              <div className="space-y-1">
                <div className="w-full h-1.5 rounded-full bg-surface-base overflow-hidden">
                  <div className="h-full bg-accent-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[11px] text-txt-tertiary tabular-nums">{pct}%</div>
              </div>
            )}

            {tr.status === 'rejected' && (
              <div className="text-[11px] text-accent-rose">{t('voice:p2p.rejectedNotice')}</div>
            )}

            {tr.status === 'failed' && (
              <div className="text-[11px] text-accent-rose">{t('voice:p2p.transferFailed')}</div>
            )}

            {tr.status === 'completed' && tr.direction === 'receive' && tr.downloadUrl && (
              <a
                href={tr.downloadUrl}
                download={tr.fileName}
                className="inline-block w-full text-center py-1.5 rounded bg-accent-primary hover:bg-accent-primary-hover text-white font-semibold transition-colors"
              >
                {t('voice:p2p.downloadFile')}
              </a>
            )}

            {tr.status === 'completed' && tr.direction === 'send' && (
              <div className="text-[11px] text-accent-mint">{t('voice:p2p.transferSent', { name: tr.fileName })}</div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Call-scoped P2P Mesh Latency Map modal (Phase 2B).
 */
export function P2PMeshModal() {
  const { t } = useTranslation(['voice', 'common']);
  const isOpen = useP2PStore((s) => s.meshModalOpen);
  const setOpen = useP2PStore((s) => s.setMeshModalOpen);
  const enabled = useP2PStore((s) => s.enabled);
  const setEnabled = useP2PStore((s) => s.setEnabled);
  const peersMap = useP2PStore((s) => s.peers);
  const instanceRttMs = useP2PStore((s) => s.instanceRttMs);
  const members = useSpaceStore((s) => s.members);

  if (!isOpen) return null;

  const peers = Object.values(peersMap);

  const resolvePeerName = (userId: string): string => {
    const member = members.find((m) => m.userId === userId);
    return member?.nickname || member?.user.displayName || member?.user.username || userId.slice(0, 8);
  };

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

        <div className="rounded-lg bg-surface-base border border-white/[0.06] p-3">
          <svg viewBox="0 0 360 210" className="w-full h-[200px]">
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

            <rect x={instX - 44} y={instY - 14} width={88} height={26} rx={6} fill="#1e293b" stroke="#475569" />
            <text x={instX} y={instY + 3} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="600">
              {t('voice:p2p.instanceNode')}
            </text>

            <circle cx={cx} cy={cy} r={20} fill="#7c3aed" stroke="#c4b5fd" strokeWidth={2} />
            <text x={cx} y={cy + 4} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">
              {t('voice:p2p.youNode')}
            </text>

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
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
