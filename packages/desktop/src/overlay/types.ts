export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface OverlaySpeakerItem {
  id: string;
  name: string;
  avatarColor?: string;
  muted?: boolean;
  deafened?: boolean;
}

export type OverlayEvent =
  | {
      kind: 'pointer_ping';
      x: number;
      y: number;
      senderName: string;
      color: string;
    }
  | {
      kind: 'pointer_clear';
    }
  | {
      kind: 'speaking_update';
      speakers: OverlaySpeakerItem[];
    }
  | {
      kind: 'toast';
      title: string;
      subtitle?: string;
      tone?: 'info' | 'join' | 'leave';
    };

export interface OverlayConfig {
  enabled: boolean;
  displayId: string | null;
  corner: OverlayCorner;
  opacity: number;
}
