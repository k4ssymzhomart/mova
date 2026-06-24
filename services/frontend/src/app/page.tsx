import CapabilitiesSection from "@/components/site/CapabilitiesSection";
import EmotionSection from "@/components/site/EmotionSection";
import FaqSection from "@/components/site/FaqSection";
import FinalCta from "@/components/site/FinalCta";
import Footer from "@/components/site/Footer";
import Hero from "@/components/site/Hero";
import Nav from "@/components/site/Nav";
import SmoothScroll from "@/components/site/SmoothScroll";
import ValuesSection from "@/components/site/ValuesSection";

/**
 * Mova landing — a single scroll-driven narrative:
 *   hero (video + stats) → capabilities scroll-narrative → pinned storytelling
 *   beat → values → testimonials → FAQ → CTA.
 */
export default function Page() {
  return (
    <SmoothScroll>
      <Nav />
      <main>
        <Hero />
        <CapabilitiesSection />
        <EmotionSection />
        <ValuesSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
