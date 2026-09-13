// The opening block of every patient page: eyebrow, H1, optional lead. Strings arrive translated.

import type { ReactNode } from "react";

import { bodyText, eyebrow as eyebrowCls, pageTitle } from "./recipes";

export default function PageHeader({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: ReactNode;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <header>
      <div className={eyebrowCls}>{eyebrow}</div>
      <h1 className={pageTitle}>{title}</h1>
      {lead && <p className={`mt-3 max-w-2xl ${bodyText}`}>{lead}</p>}
      {children}
    </header>
  );
}
