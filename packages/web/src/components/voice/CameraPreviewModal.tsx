import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import { getCameraCaptureSpec, type CameraQualityPreset } from '../../utils/screenShare';
import { handleCameraAction } from '../../utils/voiceActions';
import { Toggle } from '../ui/Toggle';

interface CameraPreviewModalProps {
  open: boolean;
  onClose: () => void;
}

const QUALITY_OPTIONS: readonly CameraQualityPreset[] = ['720p30', '1080p30', '720p60'];

export function CameraPreviewModal({ open, onClose }: CameraPreviewModalProps) {
  const { t } = useTranslation(['voice', 'common']);
  const cameraDeviceId = useVoiceStore((s) => s.cameraDeviceId);
  const setCameraDeviceId = useVoiceStore((s) => s.setCameraDeviceId);
  const mirrorLocalCamera = useVoiceStore((s) => s.mirrorLocalCamera);
  const setMirrorLocalCamera = useVoiceStore((s) => s.setMirrorLocalCamera);
  const cameraQuality = useVoiceStore((s) => s.cameraQuality);
  const setCameraQuality = useVoiceStore((s) => s.setCameraQuality);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const stopPreviewStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopPreviewStream();
      return;
    }

    let cancelled = false;
    setError('');

    const startPreview = async () => {
      stopPreviewStream();
      const spec = getCameraCaptureSpec(cameraQuality);
      const videoConstraint: MediaTrackConstraints = {
        width: { ideal: spec.resolution.width },
        height: { ideal: spec.resolution.height },
        frameRate: { ideal: spec.encoding.maxFramerate },
        ...(cameraDeviceId ? { deviceId: { ideal: cameraDeviceId } } : {}),
      };

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: cameraDeviceId ? { deviceId: { ideal: cameraDeviceId } } : true,
            audio: false,
          });
        } catch (fallbackErr) {
          if (!cancelled) {
            setError(fallbackErr instanceof Error ? fallbackErr.message : t('voice:cameraPreview.unavailable'));
          }
          return;
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices(list.filter((d) => d.kind === 'videoinput'));
        }
      } catch {
        /* ignore */
      }
    };

    void startPreview();
    return () => {
      cancelled = true;
      stopPreviewStream();
    };
  }, [open, cameraDeviceId, cameraQuality, t]);

  if (!open) return null;

  const handleConfirm = async () => {
    setStarting(true);
    // Release preview camera BEFORE LiveKit acquires it (prevents exclusive lock on Windows)
    stopPreviewStream();
    try {
      await handleCameraAction();
      onClose();
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = () => {
    stopPreviewStream();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9995] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={handleCancel} />
      <div className="relative w-full max-w-md glass-modal rounded-xl p-4 space-y-4 border border-white/[0.08]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-txt-primary">{t('voice:cameraPreview.title')}</h3>
          <button
            type="button"
            onClick={handleCancel}
            aria-label={t('common:actions.close')}
            className="text-txt-tertiary hover:text-txt-primary px-1.5 py-0.5 rounded"
          >
            ×
          </button>
        </div>

        {/* Live local webcam preview */}
        <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black border border-white/[0.06] flex items-center justify-center">
          {error ? (
            <div className="px-4 text-center text-xs text-accent-rose">{error}</div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${mirrorLocalCamera ? 'scale-x-[-1]' : ''}`}
            />
          )}
        </div>

        {/* Device selector */}
        {devices.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="camera-preview-device" className="block text-[11px] font-medium text-txt-secondary">
              {t('voice:cameraPreview.deviceLabel')}
            </label>
            <select
              id="camera-preview-device"
              value={cameraDeviceId ?? ''}
              onChange={(e) => setCameraDeviceId(e.target.value || null)}
              className="input-standard w-full appearance-none text-xs"
            >
              <option value="">{t('voice:cameraPreview.defaultDevice')}</option>
              {devices.map((dev, idx) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || t('voice:cameraPreview.cameraFallback', { index: idx + 1 })}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quality preset */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-txt-secondary">{t('voice:cameraPreview.qualityLabel')}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setCameraQuality(q)}
                className={`py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  cameraQuality === q
                    ? 'bg-accent-primary text-white border-accent-primary'
                    : 'bg-surface-base text-txt-secondary border-border-soft hover:text-txt-primary'
                }`}
              >
                {t(`voice:cameraPreview.qualities.${q}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Local mirror toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-txt-primary">{t('voice:cameraPreview.mirrorLabel')}</div>
            <div className="text-[11px] text-txt-tertiary">{t('voice:cameraPreview.mirrorHint')}</div>
          </div>
          <Toggle
            enabled={mirrorLocalCamera}
            onChange={setMirrorLocalCamera}
            ariaLabel={t('voice:cameraPreview.mirrorLabel')}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-txt-secondary text-xs font-medium transition-colors"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="button"
            disabled={starting || Boolean(error)}
            onClick={() => { void handleConfirm(); }}
            className="px-4 py-1.5 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-40"
          >
            {starting ? t('common:states.loading') : t('voice:cameraPreview.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
