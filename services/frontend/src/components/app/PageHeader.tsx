// The opening block of every patient page: eyebrow, H1, optional lead. Strings arrive translated.

import type { ReactNode } from "react";

import { bodyText, eyebrow as eyebrowCls, pageMasthead, pageMastheadStacked, pageTitle } from "./recipes";

export default function PageHeader({
  eyebrow,
  title,
  lead,
  children,
  stacked = false,
}: {
  eyebrow: ReactNode;
  title: string;
  lead?: string;
  children?: ReactNode;
  /**
   * One column, title above the lead. The session flow asks for this: it runs in the narrow task frame, where a
   * title column beside a 26rem lead is too narrow for a Russian exercise name and the browser breaks the word.
   */
  stacked?: boolean;
}) {
  return (
    <header className={stacked ? pageMastheadStacked : pageMasthead}>
      <div className="min-w-0">
        <div className={eyebrowCls}>{eyebrow}</div>
        <h1 className={pageTitle}>{title}</h1>
        {children}
      </div>
      {lead && <p className={stacked ? `mt-3 ${bodyText}` : `mt-3 lg:mt-0 ${bodyText}`}>{lead}</p>}
    </header>
  );
}
