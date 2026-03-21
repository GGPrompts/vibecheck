import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { AuditProvider } from "@/components/audit-context";
import { ActivityPanelProvider } from "@/components/activity-panel-context";
import { ActivityPanelWrapper } from "@/components/activity-panel-wrapper";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vibecheck",
  description: "Local-first codebase health dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <AuditProvider>
              <ActivityPanelProvider>
                <SidebarProvider>
                  <AppSidebar />
                  <SidebarInset className="flex flex-col h-screen">
                    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                      <SidebarTrigger className="-ml-1" />
                    </header>
                    <div className="flex-1 overflow-y-auto p-6">{children}</div>
                    <ActivityPanelWrapper />
                  </SidebarInset>
                </SidebarProvider>
              </ActivityPanelProvider>
            </AuditProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
