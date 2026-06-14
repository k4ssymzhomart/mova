import ArchitectureSection from "@/components/landing/ArchitectureSection";
import DashboardPreview from "@/components/landing/DashboardPreview";
import Footer from "@/components/landing/Footer";
import GridBackground from "@/components/landing/GridBackground";
import Hero from "@/components/landing/Hero";
import IngestionSection from "@/components/landing/IngestionSection";
import Nav from "@/components/landing/Nav";
import Reveal from "@/components/landing/Reveal";

/**
 * Master landing page — a single scroll-driven narrative:
 *   01 hook (Hero) → 02 ingestion → 03 engine → 04 console portal.
 */
export default function Page() {
  return (
    <>
      <GridBackground />
      <Nav />
      <main>
        <Hero />
        <Reveal>
          <IngestionSection />
        </Reveal>
        <Reveal>
          <ArchitectureSection />
        </Reveal>
        <Reveal>
          <DashboardPreview />
        </Reveal>
      </main>
      <Footer />
    </>
  );
}
