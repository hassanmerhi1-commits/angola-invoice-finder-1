import { useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Construction } from 'lucide-react';
import { useTranslation } from '@/i18n';

const titleKeys: Record<string, string> = {
  '/accounting': 'accounting',
  '/customers': 'customers',
  '/branches': 'branches',
  '/reports': 'reports',
  '/settings': 'settings',
};

export default function Placeholder() {
  const location = useLocation();
  const { t } = useTranslation();
  const titleKey = titleKeys[location.pathname] || 'page';
  const title = t.placeholderUi.titles[titleKey as keyof typeof t.placeholderUi.titles] as string;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Construction className="w-16 h-16 mb-4 opacity-30" />
          <h2 className="text-xl font-semibold mb-2">{t.placeholderUi.inDevelopmentTitle}</h2>
          <p>{t.placeholderUi.inDevelopmentDesc}</p>
        </CardContent>
      </Card>
    </div>
  );
}
