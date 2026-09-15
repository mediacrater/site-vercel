import { ArrowUpRight, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"

const SIGNUP_LINK = `${process.env.NEXT_PUBLIC_APP_URL}/signup`

export function CTA() { return <section className="border-b border-border py-24 md:py-32"><div className="mx-auto max-w-5xl px-4 text-center sm:px-6"><p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Before your next launch</p><h2 className="mt-5 font-[family-name:var(--font-display)] text-5xl font-bold tracking-[-.045em] sm:text-6xl">Stop guessing. Start knowing.</h2><p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">Put your creative through a policy-focused review before you put budget behind it.</p><Button asChild size="lg" className="mt-8 h-12 rounded-xl px-7 text-base font-semibold"><a href={SIGNUP_LINK} target="_blank" rel="noopener noreferrer"><Shield className="mr-2 h-4 w-4"/>Try Mediacrater free<ArrowUpRight className="ml-1 h-4 w-4"/></a></Button></div></section> }
