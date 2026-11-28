import { useTranslation } from 'react-i18next';
import { ConnectedInstances } from '../ConnectedInstances';

export function InstancesPanel() {
  const { t } = useTranslation(['settings']);
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('settings:instances.title')}</h2>
      <ConnectedInstances />
    </div>
  );
}
