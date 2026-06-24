import { EVIDENCE_NAV, FOOTER, NAV_LINKS } from "@/lib/site-data";

export default function Footer() {
  return (
    <footer className="bg-night text-white">
      <div className="mx-auto max-w-shell px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <img
              src="/logo-mova.png"
              alt="Mova"
              className="h-9 w-auto [filter:brightness(0)_invert(1)]"
            />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/55">
              Camera-free motion intelligence for movement rehabilitation —
              clinical-grade gait, balance and freezing-of-gait insight from a
              single wearable.
            </p>
          </div>

          <FooterCol title="Discover" items={FOOTER.discover} />

          <div>
            <ColTitle>Evidence</ColTitle>
            <ul className="mt-5 space-y-3 text-sm text-white/60">
              {EVIDENCE_NAV.map((e) => (
                <li key={e.href}>
                  <a href={e.href} className="hover:text-white">
                    {e.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <FooterCol title="Legals" items={FOOTER.legals} />

          <div>
            <ColTitle>Get in touch</ColTitle>
            <ul className="mt-5 space-y-3 text-sm text-white/60">
              <li>
                <a href={`mailto:${FOOTER.email}`} className="hover:text-white">
                  {FOOTER.email}
                </a>
              </li>
              <li>
                <a href={`tel:${FOOTER.phone}`} className="hover:text-white">
                  {FOOTER.phone}
                </a>
              </li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/60">
              {FOOTER.socials.map((s) => (
                <a key={s} href="#" className="hover:text-white">
                  {s}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-8 text-sm text-white/45 sm:flex-row sm:items-center">
          <span>{FOOTER.copyright}</span>
          <span>Motion intelligence for movement rehabilitation</span>
        </div>
      </div>
    </footer>
  );
}

function ColTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
      {children}
    </div>
  );
}

const HREF_OVERRIDES: Record<string, string> = {
  Research: "/research",
  "Sign in": "/signin",
  About: "#values",
  Contact: "#cta",
  Capabilities: "#capabilities",
  FAQ: "#faq",
};

function FooterCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <ColTitle>{title}</ColTitle>
      <ul className="mt-5 space-y-3 text-sm text-white/60">
        {items.map((item) => {
          const href =
            HREF_OVERRIDES[item] ??
            NAV_LINKS.find((l) => l.label === item)?.href ??
            "#";
          return (
            <li key={item}>
              <a href={href} className="hover:text-white">
                {item}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
