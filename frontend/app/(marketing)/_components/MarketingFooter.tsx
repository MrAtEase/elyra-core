import Image from "next/image";
import Link from "next/link";

export default function MarketingFooter() {
  return (
    <footer className="border-t border-white/6 bg-[#0b0f18]">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 text-sm text-white/68 md:grid-cols-[1.3fr_repeat(3,minmax(0,1fr))]">
        <div>
          <Image
            src="/brand/elyra-logo.svg"
            alt="Elyra Core"
            width={140}
            height={32}
            className="h-7 w-auto opacity-95"
          />
          <p className="mt-4 max-w-sm leading-relaxed text-white/52">
            One place where work makes sense. Built in Europe with privacy by design.
          </p>
        </div>

        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.14em] text-white/35">Product</p>
          <ul className="space-y-2">
            <li><Link href="/product" className="hover:text-white/90">Overview</Link></li>
            <li><Link href="/solutions" className="hover:text-white/90">Solutions</Link></li>
            <li><Link href="/pricing" className="hover:text-white/90">Pricing</Link></li>
            <li><Link href="/security" className="hover:text-white/90">Security</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.14em] text-white/35">Resources</p>
          <ul className="space-y-2">
            <li><Link href="/docs" className="hover:text-white/90">Documentation</Link></li>
            <li><Link href="/contact" className="hover:text-white/90">Contact</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.14em] text-white/35">Legal</p>
          <ul className="space-y-2">
            <li><Link href="/legal/privacy" className="hover:text-white/90">Privacy</Link></li>
            <li><Link href="/legal/terms" className="hover:text-white/90">Terms</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/6 px-6 py-4 text-center text-xs text-white/40">
        <span>&copy; {new Date().getFullYear()} Elyra Core - Built in Europe</span>
      </div>
    </footer>
  );
}
