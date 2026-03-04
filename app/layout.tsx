import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gorgias Webhook",
  description: "Webhook receiver for Gorgias events",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
