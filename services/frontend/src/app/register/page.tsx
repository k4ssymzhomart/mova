"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, 
  ArrowRight, 
  Mail, 
  Lock, 
  User, 
  Check,
  Video,
  Cpu,
  Activity,
  ChevronRight,
  ShieldCheck,
  Brain,
  Bone,
  Accessibility,
  Loader2
} from "lucide-react";

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"patient" | "clinician">("patient");
  
  // Patient specific steps
  const [condition, setCondition] = useState<string>("");
  const [hasCamera, setHasCamera] = useState<boolean>(true);
  const [hasIMU, setHasIMU] = useState<boolean>(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleNext = () => {
    if (step === 1) {
      if (role === "clinician") {
        // Clinicians bypass patient intake and equipment check
        submitRegistration();
      } else {
        setStep(2);
      }
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      submitRegistration();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const submitRegistration = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 1200);
  };

  const conditions = [
    { id: "stroke", title: "Stroke Rehabilitation", desc: "For post-stroke movement & compensation therapy", icon: Activity },
    { id: "parkinson", title: "Parkinson's / FoG", desc: "For gait assessment & freezing-of-gait monitoring", icon: Brain },
    { id: "ortho", title: "Orthopedic Recovery", desc: "For post-op joint Range of Motion (ROM) training", icon: Bone },
    { id: "general", title: "General Mobility", desc: "For tracking general gait stability & balance", icon: Accessibility },
  ];

  return (
    <div className="min-h-screen p-3 md:p-6 bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-6xl min-h-[calc(100vh-48px)] bg-white rounded-3xl overflow-hidden shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-0 border border-gray-100">
        
        {/* Left Side: Immersive visual panel */}
        <div className="hidden lg:block lg:col-span-5 relative p-8 bg-gray-900 text-white flex flex-col justify-between overflow-hidden">
          <div className="absolute inset-0 z-0">
            <video
              src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260602_150901_c45b90ec-18d7-42ff-90e2-b95d7109e330.mp4"
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover brightness-[0.7] opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
          </div>

          {/* Text Overlay */}
          <div className="relative z-10 flex flex-col justify-between h-full">
            <Link href="/" className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="h-6 w-6 bg-white rounded-full flex items-center justify-center text-black text-xs font-serif font-semibold italic">M</span>
              MOVA
            </Link>

            <div className="space-y-4">
              <h2 className="text-3xl font-light leading-tight tracking-tight">
                Empowering rehabilitation through <span className="font-serif italic text-white/90">spatial telemetry</span>.
              </h2>
              <p className="text-sm text-gray-300 leading-relaxed max-w-sm">
                Get started by setting up your clinical profile. Follow our guided setup to pair devices and calibrate your camera.
              </p>
            </div>

            <div className="text-xs text-gray-400">
              © {new Date().getFullYear()} MOVA Technologies, Inc.
            </div>
          </div>
        </div>

        {/* Right Side: Onboarding Content */}
        <div className="lg:col-span-7 flex flex-col justify-between p-8 md:p-16 bg-white">
          {/* Header row */}
          <div className="flex items-center justify-between">
            {step > 1 && !isSuccess ? (
              <button 
                onClick={handleBack} 
                className="flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-black transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <Link href="/" className="lg:invisible text-xl font-bold tracking-tight text-black flex items-center gap-2">
                <span className="h-6 w-6 bg-black rounded-full flex items-center justify-center text-white text-xs font-serif font-semibold italic">M</span>
                MOVA
              </Link>
            )}

            {!isSuccess && (
              <span className="text-xs font-medium text-gray-400">
                Step {step} of {role === "patient" ? 3 : 1}
              </span>
            )}
          </div>

          {/* Stepper Content */}
          <div className="my-auto py-8 max-w-md w-full mx-auto space-y-8">
            {isSuccess ? (
              <div className="space-y-6 text-center">
                <div className="h-20 w-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <Check className="h-10 w-10 stroke-[2.5]" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-3xl font-light tracking-tight text-gray-950">Registration Complete</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Your {role} profile has been successfully configured. You now have full access to the MOVA workspace.
                  </p>
                </div>

                <div className="pt-4">
                  <Link href="/dashboard">
                    <button className="w-full bg-black hover:bg-gray-800 text-white font-medium py-3 px-6 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-sm">
                      Go to Dashboard
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {/* STEP 1: IDENTITY */}
                {step === 1 && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <h2 className="text-3xl font-light tracking-tight text-gray-950">Create your account</h2>
                      <p className="text-sm text-gray-500">Sign up to begin your motion-intelligence journey.</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Select your role</label>
                        <div className="grid grid-cols-2 gap-4">
                          <button
                            type="button"
                            onClick={() => setRole("patient")}
                            className={`p-4 rounded-2xl border text-left flex flex-col justify-between h-32 transition-all ${
                              role === "patient" 
                                ? "border-black bg-gray-50 ring-1 ring-black" 
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <span className="p-2 bg-black text-white rounded-xl w-fit">
                              <User className="h-5 w-5" />
                            </span>
                            <div>
                              <div className="font-semibold text-sm text-gray-900">Patient</div>
                              <div className="text-xs text-gray-500">Tracking gait & rehab</div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setRole("clinician")}
                            className={`p-4 rounded-2xl border text-left flex flex-col justify-between h-32 transition-all ${
                              role === "clinician" 
                                ? "border-black bg-gray-50 ring-1 ring-black" 
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <span className="p-2 bg-black text-white rounded-xl w-fit">
                              <ShieldCheck className="h-5 w-5" />
                            </span>
                            <div>
                              <div className="font-semibold text-sm text-gray-900">Clinician</div>
                              <div className="text-xs text-gray-500">Monitoring patients</div>
                            </div>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Email Address</label>
                          <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-400">
                              <Mail className="h-4 w-4" />
                            </span>
                            <input
                              type="email"
                              required
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="you@domain.com"
                              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-all"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">Password</label>
                          <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-400">
                              <Lock className="h-4 w-4" />
                            </span>
                            <input
                              type="password"
                              required
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="••••••••"
                              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleNext}
                      disabled={isSubmitting || !email || !password}
                      className="w-full bg-black hover:bg-gray-800 text-white font-medium py-3.5 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {role === "patient" ? (
                        <>
                          Continue
                          <ArrowRight className="h-4 w-4" />
                        </>
                      ) : (
                        <>
                          Complete Registration
                          <ChevronRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* STEP 2: PATIENT INTAKE */}
                {step === 2 && role === "patient" && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <h2 className="text-3xl font-light tracking-tight text-gray-950">What brings you to MOVA?</h2>
                      <p className="text-sm text-gray-500">Select the primary condition or mobility focus you want to track.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {conditions.map((c) => {
                        const IconComponent = c.icon;
                        const isSelected = condition === c.id;
                        return (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() => setCondition(c.id)}
                            className={`p-4 rounded-2xl border text-left flex items-start gap-4 transition-all ${
                              isSelected 
                                ? "border-black bg-gray-50 ring-1 ring-black" 
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <span className={`p-2.5 rounded-xl w-fit ${isSelected ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'}`}>
                              <IconComponent className="h-5 w-5" />
                            </span>
                            <div>
                              <div className="font-semibold text-sm text-gray-900">{c.title}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{c.desc}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={handleNext}
                      disabled={!condition}
                      className="w-full bg-black hover:bg-gray-800 text-white font-medium py-3.5 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Continue
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* STEP 3: EQUIPMENT CHECK */}
                {step === 3 && role === "patient" && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <h2 className="text-3xl font-light tracking-tight text-gray-950">Hardware & Equipment</h2>
                      <p className="text-sm text-gray-500">Toggle the hardware options you have available for rehabilitation tracking.</p>
                    </div>

                    <div className="space-y-4">
                      {/* Camera Toggle */}
                      <button
                        type="button"
                        onClick={() => setHasCamera(!hasCamera)}
                        className={`w-full p-5 rounded-2xl border text-left flex items-center justify-between transition-all ${
                          hasCamera 
                            ? "border-black bg-gray-50/50" 
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <span className={`p-3 rounded-xl w-fit ${hasCamera ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'}`}>
                            <Video className="h-6 w-6" />
                          </span>
                          <div>
                            <div className="font-semibold text-sm text-gray-900">Device Camera</div>
                            <div className="text-xs text-gray-500">Used for camera-based pose tracking overlays</div>
                          </div>
                        </div>
                        <div className={`h-6 w-11 rounded-full p-0.5 transition-colors duration-200 ${hasCamera ? 'bg-black' : 'bg-gray-200'}`}>
                          <div className={`h-5 w-5 rounded-full bg-white shadow-sm transform duration-200 ${hasCamera ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                      </button>

                      {/* IMU Toggle */}
                      <button
                        type="button"
                        onClick={() => setHasIMU(!hasIMU)}
                        className={`w-full p-5 rounded-2xl border text-left flex items-center justify-between transition-all ${
                          hasIMU 
                            ? "border-black bg-gray-50/50" 
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <span className={`p-3 rounded-xl w-fit ${hasIMU ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'}`}>
                            <Cpu className="h-6 w-6" />
                          </span>
                          <div>
                            <div className="font-semibold text-sm text-gray-900">IMU Wearable Sensors</div>
                            <div className="text-xs text-gray-500">Used for high-frequency 50Hz telemetry synchronization</div>
                          </div>
                        </div>
                        <div className={`h-6 w-11 rounded-full p-0.5 transition-colors duration-200 ${hasIMU ? 'bg-black' : 'bg-gray-200'}`}>
                          <div className={`h-5 w-5 rounded-full bg-white shadow-sm transform duration-200 ${hasIMU ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                      </button>
                    </div>

                    <button
                      onClick={handleNext}
                      disabled={isSubmitting}
                      className="w-full bg-black hover:bg-gray-800 text-white font-medium py-3.5 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Submitting setup...
                        </>
                      ) : (
                        <>
                          Complete Registration
                          <Check className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer links */}
          <div className="flex items-center justify-between text-xs text-gray-400 pt-8 border-t border-gray-100">
            <Link href="/" className="hover:text-black transition-colors">
              Terms of Service
            </Link>
            <Link href="/" className="hover:text-black transition-colors">
              Privacy Policy & HIPAA
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
