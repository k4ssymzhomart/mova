"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, ArrowRight } from "lucide-react";

export default function Page() {
  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const tags = ["Stroke Rehab", "Parkinson's FoG", "Ortho", "Other"];

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setIsSuccess(true);
    }, 1000);
  };

  return (
    <div className="p-3 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* SECTION 1: HERO */}
      <section className="relative min-h-[calc(100vh-48px)] rounded-3xl overflow-hidden shadow-xl flex flex-col justify-between p-6 md:p-12">
        {/* Background Video */}
        <div className="absolute inset-0 z-0">
          <video
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260602_150901_c45b90ec-18d7-42ff-90e2-b95d7109e330.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover brightness-[0.85]"
          />
          {/* Overlay gradient to ensure text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
        </div>

        {/* Glassmorphic Navbar */}
        <header className="relative z-10 w-full flex justify-center">
          <nav className="w-full max-w-4xl bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl px-6 py-3 flex items-center justify-between shadow-lg">
            <Link href="/" className="text-xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
              <span className="h-6 w-6 bg-black rounded-full flex items-center justify-center text-white text-xs font-serif font-semibold italic">M</span>
              MOVA
            </Link>
            
            <div className="hidden sm:flex items-center gap-8 text-sm font-medium text-gray-900">
              <a href="#platform" className="hover:text-gray-600 transition-colors">Platform</a>
              <a href="#science" className="hover:text-gray-600 transition-colors">Science</a>
              <a href="#outcomes" className="hover:text-gray-600 transition-colors">Outcomes</a>
            </div>

            <Link href="/register">
              <button className="bg-black hover:bg-gray-800 text-white text-xs font-semibold px-5 py-2.5 rounded-full transition-all">
                Partner with us
              </button>
            </Link>
          </nav>
        </header>

        {/* Bottom Content Area */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end mt-12 lg:mt-auto">
          {/* Headline (Bottom Left) */}
          <div className="lg:col-span-7 text-white pb-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-light leading-[1.1] tracking-tight max-w-2xl drop-shadow-sm">
              We capture human motion <br />
              and turn it into <span className="font-serif italic text-white/95">intelligence</span>.
            </h1>
          </div>

          {/* Floating Clinical Pilot Card (Right) */}
          <div className="lg:col-span-5 lg:max-w-md w-full ml-auto">
            <div className="bg-white/95 backdrop-blur-lg p-8 rounded-3xl shadow-2xl border border-white/20 text-gray-900">
              {isSuccess ? (
                <div className="py-8 text-center space-y-4">
                  <div className="h-16 w-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <Check className="h-8 w-8 stroke-[2.5]" />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight">Access Requested</h3>
                  <p className="text-sm text-gray-500 max-w-xs mx-auto">
                    Thank you. A MOVA clinical coordinator will reach out to your team shortly.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight text-gray-950">Clinical Pilot Program</h3>
                    <p className="text-xs text-gray-500 mt-1">Request early integration access for your clinic.</p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="name" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Name</label>
                      <input
                        type="text"
                        id="name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Dr. Sarah Chen"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-all bg-gray-50/50"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Work Email</label>
                      <input
                        type="email"
                        id="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="schen@clinic.org"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-all bg-gray-50/50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Clinical Focus</label>
                      <div className="flex flex-wrap gap-2">
                        {tags.map((tag) => {
                          const isSelected = selectedTags.includes(tag);
                          return (
                            <button
                              type="button"
                              key={tag}
                              onClick={() => toggleTag(tag)}
                              className={`text-xs px-3.5 py-1.5 rounded-full border transition-all font-medium ${
                                isSelected
                                  ? "bg-black border-black text-white font-sans"
                                  : "bg-gray-100 hover:bg-gray-200 border-transparent text-gray-600 font-sans"
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-black hover:bg-gray-800 text-white font-medium py-3 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying credentials...
                      </>
                    ) : (
                      <>
                        Request Early Access
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: SCIENCE & TRUST */}
      <section id="science" className="bg-white rounded-3xl p-8 md:p-16 border border-gray-100 shadow-sm space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">
            Powered by Clinical-Grade Machine Learning
          </p>
          <h2 className="text-3xl md:text-4xl font-light tracking-tight text-gray-900">
            Validated models trained on subject-disjoint cohorts.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { metric: "0.723", label: "AUROC FoG Detection", desc: "Honest freeze-of-gait identification without subject data leakage." },
            { metric: "<50ms", label: "Edge CV Latency", desc: "Real-time landmark and angular velocity calculations in the browser." },
            { metric: "672k+", label: "Pretraining Windows", desc: "Self-supervised LIMU-BERT base trained across diverse gait speeds." },
            { metric: "33-Point", label: "Spatial Tracking", desc: "BlazePose skeleton mapping fused dynamically with wireless IMUs." },
          ].map((item, idx) => (
            <div key={idx} className="bg-gray-50 border border-gray-100 p-8 rounded-3xl space-y-4 hover:shadow-md transition-all">
              <div className="text-4xl font-medium tracking-tight text-black">{item.metric}</div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-900">{item.label}</div>
                <div className="text-xs text-gray-500 leading-relaxed">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3: PLATFORM CAPABILITIES */}
      <section id="platform" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1 (Dark) */}
        <div className="bg-gray-900 text-white p-8 md:p-16 rounded-3xl flex flex-col justify-between min-h-[460px] border border-gray-800 shadow-inner">
          <div className="space-y-4">
            <span className="text-xs font-semibold tracking-widest text-gray-500 uppercase">On-Device Privacy</span>
            <h3 className="text-3xl md:text-4xl font-light leading-tight tracking-tight max-w-md">
              Camera-optional.<br />
              Privacy <span className="font-serif italic text-gray-300">absolute</span>.
            </h3>
            <p className="text-sm text-gray-400 max-w-md leading-relaxed mt-4">
              Our WebGPU spider-web engine runs locally inside the browser. Landmarks are captured, keypoints smoothed, and gait metrics computed directly on the patient's device. No raw video feed ever uploads to the cloud.
            </p>
          </div>
          <div className="mt-8 pt-8 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
            <span>COMPLIANCE · HIPAA + GDPR</span>
            <span className="font-mono text-gray-500">v1.4-LITE</span>
          </div>
        </div>

        {/* Card 2 (Light) */}
        <div className="bg-gray-100 text-black p-8 md:p-16 rounded-3xl flex flex-col justify-between min-h-[460px] border border-gray-200/50 shadow-sm">
          <div className="space-y-4">
            <span className="text-xs font-semibold tracking-widest text-gray-500 uppercase">User Experience</span>
            <h3 className="text-3xl md:text-4xl font-light leading-tight tracking-tight max-w-md">
              Therapy that feels<br />
              like <span className="font-serif italic text-gray-700">play</span>.
            </h3>
            <p className="text-sm text-gray-600 max-w-md leading-relaxed mt-4">
              Gamified, physics-based rehab protocols turn repetitive motions into highly engaging biofeedback loops. Patient kinematics directly control immersive Three.js spatial tasks, fostering clinical adherence through playful milestones.
            </p>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>ENGAGEMENT · 94% ADHERENCE</span>
            <span className="font-mono text-gray-400">THREE.JS RUNTIME</span>
          </div>
        </div>
      </section>

      {/* SECTION 4: MINIMALIST FOOTER */}
      <footer id="outcomes" className="bg-white border border-gray-100 rounded-3xl p-8 md:p-12 shadow-sm grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-4 flex items-center gap-3">
          <svg
            className="w-12 h-12 text-black"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M20 80V20L50 60L80 20V80"
              stroke="currentColor"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <span className="text-xl font-bold tracking-tight">MOVA</span>
            <p className="text-xs text-gray-400">Motion Intelligence</p>
          </div>
        </div>

        <div className="md:col-span-5 grid grid-cols-3 gap-4 text-xs font-medium text-gray-500">
          <div className="space-y-2">
            <h5 className="font-semibold text-gray-900">Ecosystem</h5>
            <ul className="space-y-1.5">
              <li><Link href="/register" className="hover:text-black transition-colors">Early Access</Link></li>
              <li><Link href="/dashboard" className="hover:text-black transition-colors">Clinician Console</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <h5 className="font-semibold text-gray-900">Research</h5>
            <ul className="space-y-1.5">
              <li><a href="#" className="hover:text-black transition-colors">Publications</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Datasets</a></li>
            </ul>
          </div>
          <div className="space-y-2">
            <h5 className="font-semibold text-gray-900">Privacy</h5>
            <ul className="space-y-1.5">
              <li><a href="#" className="hover:text-black transition-colors">HIPAA</a></li>
              <li><a className="hover:text-black transition-colors">GDPR</a></li>
            </ul>
          </div>
        </div>

        <div className="md:col-span-3 text-left md:text-right text-xs text-gray-400 space-y-1">
          <p>© {new Date().getFullYear()} MOVA Technologies, Inc.</p>
          <p className="text-[10px] text-gray-300">All rights reserved. Clinical decision support systems.</p>
        </div>
      </footer>
    </div>
  );
}
