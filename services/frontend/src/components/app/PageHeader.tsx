// The opening block of every patient page: eyebrow, H1, optional lead. Strings arrive translated.

import type { ReactNode } from "react";

import { bodyText, eyebrow as eyebrowCls, pageMasthead, pageTitle } from "./recipes";

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
    <header className={pageMasthead}>
      <div className="min-w-0">
        <div className={eyebrowCls}>{eyebrow}</div>
        <h1 className={pageTitle}>{title}</h1>
        {children}
      </div>
      {lead && <p className={`mt-3 lg:mt-0 ${bodyText}`}>{lead}</p>}
    </header>
  );
}
