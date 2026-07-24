import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  FlaskConical,
  GaugeCircle,
  GitBranch,
  type LucideIcon,
  Settings,
  ShieldCheck,
  Siren,
  TrendingUp,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: "alerts" | "incidents" | "approvals";
  match?: (path: string) => boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Monitor",
    items: [
      { label: "Overview", href: "/", icon: GaugeCircle, match: (p) => p === "/" },
      {
        label: "AI Registry",
        href: "/registry",
        icon: Boxes,
        match: (p) => p.startsWith("/registry"),
      },
      { label: "Alerts", href: "/alerts", icon: Bell, badgeKey: "alerts" },
      { label: "Incidents", href: "/incidents", icon: Siren, badgeKey: "incidents" },
    ],
  },
  {
    title: "Operate",
    items: [
      { label: "Validation", href: "/validation", icon: ShieldCheck },
      { label: "Agent Monitoring", href: "/agents", icon: Bot },
      { label: "Governance", href: "/governance", icon: GitBranch, badgeKey: "approvals" },
    ],
  },
  {
    title: "Understand",
    items: [
      { label: "AI Catalog", href: "/catalog", icon: BookOpen },
      { label: "ROI & Impact", href: "/roi", icon: TrendingUp },
    ],
  },
  {
    title: "Platform",
    items: [
      { label: "Simulation", href: "/simulation", icon: FlaskConical },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems = navSections.flatMap((s) => s.items);
