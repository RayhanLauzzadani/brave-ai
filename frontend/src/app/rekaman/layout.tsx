import { AppShell } from "@/components/layout/app-shell";

export default function RekamanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
