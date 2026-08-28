"use client"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Menu, X, ChevronDown } from "lucide-react"
import { supabase } from "@/lib/mediacrater/supabaseClient"
const EXTENSION_LINK = "https://chromewebstore.google.com/detail/mediacrater-ad-compliance/fgekklkpomdcadiaekpigidkimnkjpnf?utm_medium=website_header"
export function Header() {
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme } = useTheme()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Auth state — same shared client the rest of the app uses, so this
  // reflects whatever session already exists (dashboard, settings, etc.)
  // without a second Supabase client instance.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email ?? null)
      setAuthLoaded(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Close the dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handleSignOut() {
    setDropdownOpen(false)
    setMobileMenuOpen(false)
    await supabase.auth.signOut()
    router.push("/signin")
  }

  const logoSrc = mounted && resolvedTheme === "dark" 
    ? "/images/header-logo-dark.png" 
    : "/images/header-logo.png"
  const navLinks = [
    { href: "#features", label: "Features" },
    { href: "https://www.youtube.com/watch?v=Jk_XtsN1N9I?utm_medium=website_how-it-works", label: "How It Works" },
    { href: "#pricing", label: "Pricing" },
    { href: "#faq", label: "FAQ" },
  ]
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="bg-amber-100 dark:bg-transparent text-amber-700 dark:text-[#fbbf24] text-center py-2 px-5 text-xs font-semibold border-b border-[#fde68a] dark:border-[#4d2900] tracking-[0.2px]">
        Major update underway: expect intermittent delays.
      </div>
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src={logoSrc || "/placeholder.svg"}
              alt="Mediacrater Logo"
              width={40}
              height={40}
              className="h-10 w-10"
            />
            <span className="text-xl font-bold text-foreground font-[family-name:var(--font-display)]">
              Mediacrater
            </span>
          </Link>
          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
          {/* Desktop CTA */}
          <div className="hidden md:flex md:items-center md:gap-4">
            <ThemeToggle />
            {authLoaded && userEmail ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors max-w-[220px]"
                >
                  <span className="truncate">{userEmail}</span>
                  <ChevronDown className="h-4 w-4 flex-shrink-0" />
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card shadow-lg py-1.5 z-50">
                    <Link
                      href="/dashboard"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                    >
                      Go to dashboard
                    </Link>
                    <div className="my-1 border-t border-border" />
                    <a
                      href={EXTENSION_LINK}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                    >
                      Get the Chrome extension ↗
                    </a>
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-secondary transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : authLoaded ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/signin"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
                >
                  Log in
                </Link>
                <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Link href="/signup">Sign up</Link>
                </Button>
              </div>
            ) : (
              // Avoids a flash of either state before the session check resolves
              <div className="w-[140px] h-9" />
            )}
          </div>
          {/* Mobile Controls */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              className="p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            <div className="flex flex-col gap-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              {userEmail ? (
                <>
                  <div className="text-sm font-medium text-foreground truncate pt-2 border-t border-border">
                    {userEmail}
                  </div>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Go to dashboard
                  </Link>
                  <a
                    href={EXTENSION_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Get the Chrome extension ↗
                  </a>
                  <Button onClick={handleSignOut} variant="outline" className="mt-1">
                    Sign Out
                  </Button>
                </>
              ) : (
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <Button asChild variant="outline">
                    <Link href="/signin" onClick={() => setMobileMenuOpen(false)}>
                      Log in
                    </Link>
                  </Button>
                  <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Link href="/signup" onClick={() => setMobileMenuOpen(false)}>
                      Sign up
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
