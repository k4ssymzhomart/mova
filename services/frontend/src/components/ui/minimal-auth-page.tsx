import React from "react";
import { Button } from "@/components/ui/button";

import { ChevronLeftIcon } from "lucide-react";
import { Particles } from "@/components/ui/particles";

export function MinimalAuthPage() {
  return (
    <div className="relative w-full md:h-screen md:overflow-hidden">
      <Particles
        color="#16A35B"
        quantity={120}
        ease={20}
        className="absolute inset-0"
      />

      {/* soft brand-neutral light wash behind the card */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-1/2 top-0 h-[60rem] w-[60rem] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(22,163,91,0.10), rgba(22,163,91,0) 70%)",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4">
        <Button variant="ghost" className="absolute left-4 top-4" asChild>
          <a href="/">
            <ChevronLeftIcon className="me-1 size-4" />
            Home
          </a>
        </Button>

        <div className="mx-auto w-full space-y-5 sm:max-w-sm">
          <div className="flex items-center gap-2">
            <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
          </div>

          <div className="flex flex-col space-y-1">
            <h1 className="font-serif text-3xl tracking-wide">
              Sign in or create your account
            </h1>
            <p className="text-muted-foreground text-base">
              Log in or create your Mova account to access the platform.
            </p>
          </div>

          <div className="space-y-2.5">
            <Button type="button" size="lg" className="w-full">
              <GoogleIcon className="me-2 size-4" />
              Continue with Google
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="w-full"
            >
              <GithubIcon className="me-2 size-4" />
              Continue with GitHub
            </Button>
          </div>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-2.5">
            <input
              type="email"
              required
              placeholder="you@clinic.org"
              className="bg-background focus-visible:ring-ring h-11 w-full rounded-md border border-input px-3 text-sm outline-none transition focus-visible:ring-2"
            />
            <Button type="submit" variant="secondary" size="lg" className="w-full">
              Continue with email
            </Button>
          </form>

          <p className="text-muted-foreground mt-8 text-sm">
            By continuing, you agree to our{" "}
            <a
              href="#"
              className="hover:text-primary underline underline-offset-4"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="#"
              className="hover:text-primary underline underline-offset-4"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

const GoogleIcon = (props: React.ComponentProps<"svg">) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <g>
      <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669   C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62   c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401   c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
    </g>
  </svg>
);

const GithubIcon = (props: React.ComponentProps<"svg">) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.523 2 12 2z"
    />
  </svg>
);
