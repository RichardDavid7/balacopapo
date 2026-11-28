import { useTranslation } from 'react-i18next';
import { ConnectedInstances } from '../ConnectedInstances';
import { LastFmUserSection } from './LastFmUserSection';

export function ConnectionsPanel() {
  const { t } = useTranslation(['settings']);
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-txt-primary mb-2">{t('settings:connections.title')}</h2>
      <LastFmUserSection />
      <ConnectedInstances />
    </div>
  );
}
