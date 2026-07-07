import Image from "next/image";
import { getDictionary } from "@/i18n/config";
import { Card } from "@/components/ui";

export default async function PendingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="max-w-md text-center">
        <Image
          src="/logo.png"
          alt="U Learn"
          width={72}
          height={72}
          className="mx-auto mb-4"
        />
        <h1 className="text-xl font-bold">{t.auth.pendingTitle}</h1>
        <p className="mt-4 text-muted">{t.auth.pendingMessage}</p>
        <div className="mt-6 inline-flex rounded-full bg-warning/15 px-4 py-2 text-sm text-warning">
          Pending Approval
        </div>
      </Card>
    </div>
  );
}
