import React from "react"
import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'
import { JetBrains_Mono } from 'next/font/google'
 
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-data',
  display: 'swap',
})

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"]
});

export const metadata: Metadata = {
  // ✅ Add metadataBase so Next.js can resolve absolute URLs
  metadataBase: new URL('https://mediacrater.com'),

  title: 'Video Ad Policy Checker — Scan Before You Upload | Mediacrater',
  description: 'Stop getting banned. Scan video ads for Meta & TikTok policy violations before you upload. Get instant AI confidence scores and actionable fixes.',
  keywords: [
  'video ad policy checker',
  'scan ad before uploading',
  'ad rejection checker',
  'pre-upload ad compliance',
  'meta ad policy violation checker',
  'tiktok ad rejected fix',
  'google ads disapproved video',
  'ad creative compliance tool',
  'facebook ad rejected no reason',
  'ad account ban prevention',
  ],
  authors: [{ name: 'Mediacrater' }],
  creator: 'Mediacrater',


  openGraph: {
    title: 'Video Ad Policy Checker — Scan Before You Upload | Mediacrater',
    description: 'Scan video ads for policy violations before uploading. Get AI confidence scores and actionable fixes instantly.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Mediacrater',
    url: 'https://mediacrater.com',

    images: [
      {
        url: '/images/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Mediacrater - Scan video ads for policy violations before uploading',
      }
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Mediacrater - AI Video Ad Policy Compliance Checker',
    description: 'Scan video ads for policy violations before uploading. Get AI confidence scores and actionable fixes instantly.',

    images: ['/images/og-image.png'],
  },

  robots: {
    index: true,
    follow: true,
  },

  alternates: {
    canonical: 'https://mediacrater.com',
  },
  
  icons: {
    icon: [
      {
        url: '/images/header-logo.png',

      },
      {
        url: '/images/header-logo-dark.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: [
      {
        url: '/images/header-logo.png',
      },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${plusJakarta.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
