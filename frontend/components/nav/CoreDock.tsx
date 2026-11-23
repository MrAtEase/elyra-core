"use client";

import type { ReactNode, MouseEvent, FocusEvent, TouchEvent } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckSquare,
  FileText,
  Gauge,
  Mail,
  Megaphone,
  Plug,
  ShoppingBag,
  Settings,
  TrendingUp,
  Users,
  Wrench,
  Brain,
  Workflow,
  ChevronDown,
  BriefcaseBusiness,
} from "lucide-react";
import { useT } from "@/lib/i18n/useT";
import type { NavItem } from "@/lib/dashboard/types";

const ICON_PROPS = {
  size: 18,
  strokeWidth: 1.6,
};

const ICONS: Record<string, ReactNode> = {
  dashboard: <Gauge {...ICON_PROPS} />,
  calendar: <CalendarDays {...ICON_PROPS} />,
  mail: <Mail {...ICON_PROPS} />,
  tasks: <CheckSquare {...ICON_PROPS} />,
  docs: <FileText {...ICON_PROPS} />,
  sales: <TrendingUp {...ICON_PROPS} />,
  hr: <Users {...ICON_PROPS} />,
  marketing: <Megaphone {...ICON_PROPS} />,
  build: <Wrench {...ICON_PROPS} />,
  automations: <Workflow {...ICON_PROPS} />,
  reasoning: <Brain {...ICON_PROPS} />,
  integrations: <Plug {...ICON_PROPS} />,
  marketplace: <ShoppingBag {...ICON_PROPS} />,
  settings: <Settings {...ICON_PROPS} />,
  work: <BriefcaseBusiness {...ICON_PROPS} />,
};

const GROUP_ORDER = ["top", "work", "business", "build", "bottom"];
const GROUP_LABEL_KEYS: Record<string, string | null> = {
  top: null,
  work: "nav.group.work",
  business: "nav.group.business",
  build: "nav.group.build",
  bottom: null,
};
const COLLAPSIBLE_GROUPS = new Set(["work", "build"]);

type CoreDockProps = {
  items: NavItem[];
  activeCategoryId?: string;
  onItemHover?: (item: NavItem, anchorRect: DOMRect) => void;
  onDockLeave?: () => void;
  onNavLinkClick?: () => void;
};

export default function CoreDock({
  items,
  activeCategoryId,
  onItemHover,
  onDockLeave,
  onNavLinkClick,
}: CoreDockProps) {
  const groupedItems = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    const group = item.group ?? "top";
    if (!acc[group]) {
      acc[group] = [];
    }
    acc[group].push(item);
    return acc;
  }, {});
  const t = useT();

  const sortedGroups = GROUP_ORDER.filter((group) => groupedItems[group]?.length);
  const topGroups = sortedGroups.filter((group) => group !== "bottom");
  const bottomGroups = sortedGroups.filter((group) => group === "bottom");

  const renderNavLinks = (group: string) => {
    const list = (groupedItems[group] ? [...groupedItems[group]] : []).sort((a, b) => a.order - b.order);
    return list.map((item) => {
      const isActive = item.id === activeCategoryId;
      const emitAnchor = (eventTarget: HTMLAnchorElement | null) => {
        if (!eventTarget) {
          return;
        }
        onItemHover?.(item, eventTarget.getBoundingClientRect());
      };
      const iconKey = item.icon ?? item.id;
      const label = item.labelKey ? t(item.labelKey) : item.label;
      return (
        <Link
          key={item.id}
          href={item.route}
          className={`workspace-core-dock__item ${isActive ? "is-active" : ""}`}
          aria-current={isActive ? "page" : undefined}
          scroll={false}
          onClick={() => {
            onNavLinkClick?.();
          }}
          onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) =>
            emitAnchor(event.currentTarget)
          }
          onFocus={(event: FocusEvent<HTMLAnchorElement>) => emitAnchor(event.currentTarget)}
          onTouchStart={(event: TouchEvent<HTMLAnchorElement>) =>
            emitAnchor(event.currentTarget)
          }
        >
          <span className="workspace-core-dock__icon" aria-hidden="true">
            {ICONS[iconKey] ?? ICONS.dashboard}
          </span>
          <span className="workspace-core-dock__text">{label}</span>
        </Link>
      );
    });
  };

  return (
    <nav
      className="workspace-core-dock"
      aria-label="Workspace core navigation"
      onMouseLeave={onDockLeave}
    >
      <div className="workspace-core-dock__stack">
        {topGroups.map((group) => {
          const labelKey = GROUP_LABEL_KEYS[group];
          const label = labelKey ? t(labelKey) : null;
          const navLinks = renderNavLinks(group);
          if (!navLinks.length) {
            return null;
          }
          const isAccordion = Boolean(label && COLLAPSIBLE_GROUPS.has(group));
          if (label && isAccordion) {
            return (
              <details
                key={group}
                className="workspace-core-dock__group workspace-core-dock__groupAccordion"
                open
              >
                <summary className="workspace-core-dock__groupSummary">
                  <span className="workspace-core-dock__groupLabel">{label}</span>
                  <ChevronDown className="workspace-core-dock__groupAccordionChevron" aria-hidden="true" />
                </summary>
                <div className="workspace-core-dock__groupItems">{navLinks}</div>
              </details>
            );
          }
          return (
            <div className="workspace-core-dock__group" key={group}>
              {label ? <p className="workspace-core-dock__groupLabel">{label}</p> : null}
              <div className="workspace-core-dock__groupItems">{navLinks}</div>
            </div>
          );
        })}
      </div>
      {bottomGroups.length > 0 ? <div className="workspace-core-dock__spacer" /> : null}
      {bottomGroups.map((group) => (
        <div className="workspace-core-dock__group" key={group}>
          <div className="workspace-core-dock__groupItems">{renderNavLinks(group)}</div>
        </div>
      ))}
    </nav>
  );
}
