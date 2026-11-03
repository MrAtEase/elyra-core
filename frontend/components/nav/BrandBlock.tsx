import Image from "next/image";
import type { CSSProperties } from "react";

import { BRAND } from "@/components/merlin/brandConfig";

type BrandInfo = {
  logoUrl?: string | null;
  productName: string;
  assistantName: string;
  workspaceLabel: string;
  accentColor?: string | null;
};

type BrandBlockProps = {
  brand?: BrandInfo;
};

const DEFAULT_BRAND: BrandInfo = {
  productName: BRAND.productName,
  assistantName: BRAND.agentName,
  workspaceLabel: BRAND.workspaceLabel,
  logoUrl: BRAND.logoSrc ?? null,
};

export default function BrandBlock({ brand }: BrandBlockProps) {
  const resolvedBrand: BrandInfo = {
    ...DEFAULT_BRAND,
    ...brand,
  };
  const accentColor = resolvedBrand.accentColor ?? "#5cffec";
  const logoUrl =
    typeof resolvedBrand.logoUrl === "string" && resolvedBrand.logoUrl.trim()
      ? resolvedBrand.logoUrl.trim()
      : null;
  const style = { "--brand-accent": accentColor } as CSSProperties;

  return (
    <div className="brandBlock" style={style}>
      <div className="brandBlock__logo">
        {logoUrl ? (
          <Image src={logoUrl} alt={`${resolvedBrand.productName} logo`} fill sizes="48px" />
        ) : (
          <span className="brandBlock__logoPlaceholder" aria-hidden="true" />
        )}
      </div>
      <div className="brandBlock__text">
        <p className="brandBlock__line brandBlock__line--product">{resolvedBrand.productName}</p>
        <p className="brandBlock__line brandBlock__line--agent">{resolvedBrand.assistantName}</p>
        <p className="brandBlock__line brandBlock__line--workspace">{resolvedBrand.workspaceLabel}</p>
      </div>
    </div>
  );
}
