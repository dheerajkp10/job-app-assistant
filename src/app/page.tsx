import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/db';
import OnboardingWizard from '@/components/onboarding/onboarding-wizard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const settings = await getSettings();

  if (settings.onboardingComplete) {
    redirect('/dashboard');
  }

  return <OnboardingWizard />;
}
