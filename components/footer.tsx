"use client"

import Image from "next/image"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useState, useEffect } from "react"

export function Footer() {
  const currentYear = new Date().getFullYear()
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Footer has inverted colors (dark bg in light mode, light bg in dark mode)
  // So we swap the logo logic: light mode footer (dark bg) needs dark-optimized logo
  // Dark mode footer (light bg) needs light-optimized logo
  const logoSrc = mounted && resolvedTheme === "dark" 
    ? "/images/footer-logo.png" 
    : "/images/footer-logo-dark.png"

  return (
    <footer className="bg-foreground text-background py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <Image
              src={logoSrc || "/placeholder.svg"}
              alt="Mediacrater"
              width={180}
              height={60}
              className="h-16 w-auto"
            />
            <p className="mt-4 text-background/70 max-w-md leading-relaxed">
              The first comprehensive Chrome extension designed to be the final gatekeeper for your ad creatives.
              Scan before you upload. Protect your ad accounts.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-background mb-4">Quick Links</h3>
            <ul className="space-y-3">
              <li>
                <Link href="#features" className="text-background/70 hover:text-background transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="#how-it-works" className="text-background/70 hover:text-background transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-background/70 hover:text-background transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="#faq" className="text-background/70 hover:text-background transition-colors">
                  FAQ
                </Link>
              </li>
                <li>
                <Link href="/changelog" className="text-background/70 hover:text-background transition-colors">
                  Changelogs
                </Link>
              </li>
                <li>
                <Link href="/solutions" className="text-background/70 hover:text-background transition-colors">
                  Custom solutions
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-background mb-4">Legal</h3>
            <ul className="space-y-3">
              <li>
                <Link href="/privacy" className="text-background/70 hover:text-background transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/chrome-extension-privacy" className="text-background/70 hover:text-background transition-colors">
                  Extension Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-background/70 hover:text-background transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/refund" className="text-background/70 hover:text-background transition-colors">
                  Refund Policy
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="text-background/70 hover:text-background transition-colors">
                  Cookie policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-12 pt-8 border-t border-background/20">
          <p className="text-xs text-background/50 leading-relaxed max-w-4xl">
            <strong>Disclaimer:</strong> Mediacrater does not make any promises or guarantees that a video ad will be approved.
            Our software provides a general confidence assessment based on publicly accessible ad policies. Your video is still subject
            to each platform's detection algorithms. Mediacrater does not replace, mirror, or bypass advertising detection algorithms
            of Facebook and Instagram (Meta), TikTok, YouTube, Google, Pinterest, or X. We are not affiliated with, endorsed by, or sponsored by any of these platforms.
            Platform logos are displayed solely for user experience. Mediacrater is not responsible for misuse of ad platforms or account bans.
          </p>
        </div>
        <div className="mt-12 pt-8 border-t border-background/20">
          <p className="text-xs text-background/50 leading-relaxed max-w-4xl">
            *The "Get instant confidence scores and actionable fixes in 60 seconds" claim varies based on the length of your video and scan type.
          </p>
        </div>  
        {/* Copyright */}
        <div className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-background/60">
            © {currentYear} Mediacrater. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="https://x.com/Mediacraterads"
              target="_blank"
              rel="noopener noreferrer"
              className="text-background/60 hover:text-background transition-colors"
              aria-label="Twitter"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/mediacrater_official"
              target="_blank"
              rel="noopener noreferrer"
              className="text-background/60 hover:text-background transition-colors"
              aria-label="Instagram"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
            <a
              href="https://www.youtube.com/@Mediacrater"
              target="_blank"
              rel="noopener noreferrer"
              className="text-background/60 hover:text-background transition-colors"
              aria-label="YouTube"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
