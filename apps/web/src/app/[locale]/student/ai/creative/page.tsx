import { redirect } from "next/navigation";

/** Creative tools live inside AI chat now (ask + attach). */
export default async function CreativeStudioRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/student/ai`);
}
