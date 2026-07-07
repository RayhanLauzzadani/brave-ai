import { AppShell } from "@/components/layout/app-shell";

export default function LiveViewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
