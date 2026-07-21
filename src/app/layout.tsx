import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import MotionProvider from "@/components/MotionProvider";
import RegisterSW from "@/components/RegisterSW";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  title: "Coastline",
  description: "San Diego → Vancouver → San Diego. Our coast, our plan.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Coastline",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // no maximumScale: capping it blocks pinch-zooming text (accessibility);
  // iOS ignores the cap anyway and the map handles its own gestures
  viewportFit: "cover",
  // hexes mirror --bg values in globals.css (meta tags can't read CSS vars)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f13" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}
      >
        {/* apply the saved theme + accent before first paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("coastline-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;var a=localStorage.getItem("coastline-accent");if(a&&a!=="ocean")document.documentElement.dataset.accent=a}catch(e){}})()',
          }}
        />
        <RegisterSW />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
