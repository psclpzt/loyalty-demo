import React, { useMemo, useState } from "react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { Check, ChevronLeft, ChevronRight, DollarSign, ListChecks, Settings } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * ROLLER Loyalty — Setup Wizard (TS)
 * -----------------------------------------------------------
 * Structure:
 *  - Program basics
 *  - Program rules (Earning, Redemption, Expiry) + Program Cost Estimator
 *  - Eligible items (incl. exclusions)
 *  - Review & publish
 */

// ---------- Types ---------- //

type CategoryId = "session" | "standard" | "stock" | "party" | "membership";

type ChannelMap = { pos: boolean; online: boolean; ssk: boolean; api: boolean };

type EarnOverrides = Record<CategoryId, number>; // %+/- vs base earn

type MultiplierMap = Record<CategoryId, number>; // × points per category

interface BasicsConfig {
  name: string;
  venues: string[];
  currency: string;
  pointValue: number; // $ per point
  rounding: number; // default points rounding increment for earn accrual
  timezone: string;
}

interface WelcomeBonusConfig { enabled: boolean; bonusPoints: number }

interface EarnConfig {
  ptsPerDollar: number;
  earnOnTax: boolean;
  minSpend: number;
  channels: ChannelMap;
  itemOverrides: EarnOverrides;
  caps: { perTxn: number; perDay: number };
  excludeTenders: string[];
  welcome: WelcomeBonusConfig; // on join, no spend threshold
}

interface RedeemConfig {
  mode: "priceForPoints";
  allowPartial: boolean;
  allowSplitTender: boolean;
  increment: number; // redemption rounding in points
  multipliers: MultiplierMap;
  exclusions: string[];
  offPeakOnly: boolean;
}

interface EligibilityConfig {
  scope: "categories" | "products";
  categories: CategoryId[];
  products: string[]; // product IDs
}

interface ExpiryConfig {
  policy: "rollingInactivity";
  months: number; // inactivity months
  graceEmailDays: number;
  autoExtend: boolean;
}

interface Config {
  basics: BasicsConfig;
  earn: EarnConfig;
  redeem: RedeemConfig;
  eligibility: EligibilityConfig;
  expiry: ExpiryConfig;
}

interface Category { id: CategoryId; name: string }
interface Product { id: string; name: string; category: CategoryId }

interface Step {
  key: StepKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

type StepKey = "basics" | "program" | "eligibility" | "review";

// ---------- Mock data ---------- //

const MOCK_CATEGORIES: Category[] = [
  { id: "session", name: "Session passes" },
  { id: "standard", name: "Standard passes" },
  { id: "stock", name: "Stock (F&B & Merch)" },
  { id: "party", name: "Party packages" },
  { id: "membership", name: "Memberships" },
];

const MOCK_PRODUCTS: Product[] = [
  { id: "jump1h", name: "1‑hour jump pass", category: "session" },
  { id: "jumpDay", name: "All day jump pass", category: "standard" },
  { id: "climb30", name: "30‑min climb pass add‑on", category: "session" },
  { id: "ltag1", name: "Laser Tag – 1 game", category: "session" },
  { id: "burger", name: "Burger", category: "stock" },
  { id: "socks", name: "Jump socks", category: "stock" },
  { id: "giftcard", name: "Gift Card", category: "standard" },
];

const steps: readonly Step[] = [
  { key: "basics", label: "Program basics", icon: Settings },
  { key: "program", label: "Program rules", icon: DollarSign },
  { key: "eligibility", label: "Eligible items", icon: ListChecks },
  { key: "review", label: "Review & publish", icon: Check },
] as const;

// ---------- UI helpers ---------- //

function Divider(): JSX.Element { return <div className="h-px bg-gray-200 my-6" /> }

function PrimaryButton(props: ComponentProps<typeof Button>): JSX.Element {
  return <Button {...props} className={`bg-rose-600 hover:bg-rose-700 text-white rounded-xl ${props.className || ""}`} />;
}

function OutlineButton(props: ComponentProps<typeof Button>): JSX.Element {
  return <Button variant="outline" {...props} className={`rounded-xl border-gray-300 text-gray-800 hover:bg-gray-50 ${props.className || ""}`} />;
}

function Row({ children, className = "" }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={`grid md:grid-cols-2 gap-3 md:gap-6 ${className}`}>{children}</div>;
}

function RLLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <Label className="text-[11px] uppercase tracking-wide text-gray-600">{children}</Label>;
}

function RLInput(props: ComponentProps<typeof Input>): JSX.Element {
  return <Input {...props} className={`h-9 rounded-lg border-gray-300 focus-visible:ring-1 focus-visible:ring-blue-600 ${props.className || ""}`} />
}

// ---------- Utils ---------- //

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function estimateProgramCostPct(ptsPerDollar: number, dollarsPerPoint: number, redemptionPct: number, expiryPct: number): number {
  const red = clamp01(redemptionPct / 100);
  const exp = clamp01(expiryPct / 100);
  const baseValuePerDollar = ptsPerDollar * dollarsPerPoint; // $ value accrued per $ of sales
  return baseValuePerDollar * red * (1 - exp) * 100; // % of sales
}

// ---------- Root component ---------- //

export default function RollerLoyaltyWizard(): JSX.Element {
  const [active, setActive] = useState<StepKey>("basics");
  const [published, setPublished] = useState<boolean>(false);

  const [cfg, setCfg] = useState<Config>({
    basics: { name: "ROLLER Rewards", venues: ["Main venue"], currency: "USD", pointValue: 0.01, rounding: 10, timezone: "Auto" },
    earn: {
      ptsPerDollar: 9.5,
      earnOnTax: false,
      minSpend: 5,
      channels: { pos: true, online: true, ssk: true, api: true },
      itemOverrides: { session: 0, standard: 0, stock: -50, party: 0, membership: 0 },
      caps: { perTxn: 5000, perDay: 15000 },
      excludeTenders: ["Gift cards", "Store credit"],
      welcome: { enabled: true, bonusPoints: 1000 },
    },
    redeem: {
      mode: "priceForPoints",
      allowPartial: true,
      allowSplitTender: true,
      increment: 10,
      multipliers: { session: 0.6, standard: 0.6, stock: 1.5, party: 1.0, membership: 1.0 },
      exclusions: ["Gift cards", "3rd‑party vouchers"],
      offPeakOnly: false,
    },
    eligibility: { scope: "categories", categories: ["session", "standard", "stock"], products: [] },
    expiry: { policy: "rollingInactivity", months: 12, graceEmailDays: 14, autoExtend: true },
  });

  const idx = steps.findIndex((s) => s.key === active);
  const next = (): void => setActive(steps[Math.min(idx + 1, steps.length - 1)].key);
  const prev = (): void => setActive(steps[Math.max(idx - 1, 0)].key);

  return (
    <div className="min-h-screen bg-[#F6F8FB]">
      {/* Top app bar to match VM */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-3 md:px-6 h-14 md:h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-blue-700" />
            <h1 className="text-lg md:text-xl font-semibold text-gray-800">Loyalty</h1>
            <span className="text-sm text-gray-400">•</span>
            <span className="text-sm text-gray-600">Setup</span>
          </div>
          <div className="flex items-center gap-2">
            <OutlineButton>Cancel</OutlineButton>
            <PrimaryButton>Save</PrimaryButton>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-3 md:p-6 grid md:grid-cols-[280px_1fr] gap-4 md:gap-6">
        {/* Left rail like ROLLER nav list */}
        <aside className="w-full md:w-64 bg-white border rounded-xl shadow-sm">
          <div className="px-4 py-3 border-b">
            <div className="text-sm font-semibold text-gray-800">ROLLER Loyalty</div>
          </div>
          <ol className="p-2">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isActive = s.key === active;
              return (
                <li key={s.key}>
                  <button
                    onClick={() => setActive(s.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition border ${isActive ? "bg-blue-50 text-blue-800 border-blue-200" : "hover:bg-gray-50 border-transparent text-gray-700"}`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? "text-blue-700" : "text-gray-500"}`} />
                    <span className="text-sm">{i + 1}. {s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* Main panel */}
        <main className="space-y-4">
          <Card className="rounded-xl border shadow-sm">
            <CardContent className="p-4 md:p-6">
              {active === "basics" && <Basics cfg={cfg} setCfg={setCfg} />}
              {active === "program" && <ProgramRules cfg={cfg} setCfg={setCfg} />}
              {active === "eligibility" && <Eligibility cfg={cfg} setCfg={setCfg} />}
              {active === "review" && <Review cfg={cfg} setPublished={setPublished} />}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <OutlineButton onClick={prev} disabled={active === steps[0].key}><ChevronLeft className="mr-2 h-4 w-4"/>Back</OutlineButton>
            {active !== "review" ? (
              <PrimaryButton onClick={next}>Next<ChevronRight className="ml-2 h-4 w-4"/></PrimaryButton>
            ) : null}
          </div>

          {published && (
            <Card className="rounded-xl">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-3">Program JSON (for engineers)</h3>
                <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-[420px]">{JSON.stringify(cfg, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------- Step panes ---------- //

type PaneProps = { cfg: Config; setCfg: Dispatch<SetStateAction<Config>> };

function Basics({ cfg, setCfg }: PaneProps): JSX.Element {
  const [name, setName] = useState<string>(cfg.basics.name);
  const [pointValue, setPointValue] = useState<number>(cfg.basics.pointValue);
  const [rounding, setRounding] = useState<number>(cfg.basics.rounding);
  const ptsPerTenDollars = useMemo(() => (10 / pointValue), [pointValue]);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-1 text-gray-800">Program basics</h2>
      <p className="text-sm text-gray-600 mb-6">Set the point value and defaults. Existing points keep historical value.</p>
      <Row>
        <div>
          <RLLabel>Program name</RLLabel>
          <RLInput value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <RLLabel>Point value (dollars per point)</RLLabel>
          <div className="flex items-center gap-2">
            <RLInput type="number" min={0.001} step={0.001} value={pointValue} onChange={(e) => setPointValue(parseFloat(e.target.value || "0"))} />
            <div className="text-xs text-gray-500">1,000 pts = ${(1000 * pointValue).toFixed(2)}</div>
          </div>
        </div>
        <div>
          <RLLabel>Default rounding (pts)</RLLabel>
          <RLInput type="number" min={1} step={1} value={rounding} onChange={(e) => setRounding(parseInt(e.target.value || "0", 10))} />
        </div>
        <div className="text-sm text-gray-600 flex items-end">At this point value, a $10 item costs <b className="mx-1">{ptsPerTenDollars.toLocaleString()}</b> points.</div>
      </Row>
      <Divider />
      <PrimaryButton onClick={() => setCfg((c) => ({ ...c, basics: { ...c.basics, name, pointValue, rounding } }))}>Save basics</PrimaryButton>
    </section>
  );
}

function ProgramRules({ cfg, setCfg }: PaneProps): JSX.Element {
  // Earn
  const [rate, setRate] = useState<number>(cfg.earn.ptsPerDollar);
  const [minSpend, setMinSpend] = useState<number>(cfg.earn.minSpend);
  const [caps, setCaps] = useState<{ perTxn: number; perDay: number }>(cfg.earn.caps);
  const [channels, setChannels] = useState<ChannelMap>(cfg.earn.channels);
  const [overrides, setOverrides] = useState<EarnOverrides>(cfg.earn.itemOverrides);
  const [wel, setWel] = useState<WelcomeBonusConfig>(cfg.earn.welcome);

  // Redeem
  const [allowPartial, setAllowPartial] = useState<boolean>(cfg.redeem.allowPartial);
  const [allowSplit, setAllowSplit] = useState<boolean>(cfg.redeem.allowSplitTender);
  const [increment, setIncrement] = useState<number>(cfg.redeem.increment);
  const [mx, setMx] = useState<MultiplierMap>(cfg.redeem.multipliers);

  // Expiry
  const [months, setMonths] = useState<number>(cfg.expiry.months);
  const [grace, setGrace] = useState<number>(cfg.expiry.graceEmailDays);
  const [autoExtend, setAutoExtend] = useState<boolean>(cfg.expiry.autoExtend);

  // Program Cost Estimator (operator-facing)
  const [assumedRedemption, setAssumedRedemption] = useState<number>(60); // % of points redeemed
  const [assumedExpiry, setAssumedExpiry] = useState<number>(20); // % of points that expire unused

  const estProgramCostPct = useMemo(() => estimateProgramCostPct(rate, cfg.basics.pointValue, assumedRedemption, assumedExpiry), [rate, cfg.basics.pointValue, assumedRedemption, assumedExpiry]);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-1 text-gray-800">Program rules</h2>
      <p className="text-sm text-gray-600 mb-6">Configure how guests earn, redeem, and when points expire. The estimator helps forecast program cost.</p>

      {/* Earning */}
      <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 mt-0 shadow-[inset_4px_0_0_0_rgba(16,185,129,0.8)]">
        <div className="flex items-center gap-2 mb-1">
          <div className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">Earning</div>
          <span className="text-[12px] text-emerald-700">How points are issued</span>
        </div>
        <p className="text-xs text-gray-600 mb-3">Set your base earn, caps, channels and a one‑time welcome bonus.</p>
        <Row>
          <div>
            <RLLabel>Points per $</RLLabel>
            <RLInput type="number" step={0.1} value={rate} onChange={(e) => setRate(parseFloat(e.target.value || "0"))} />
          </div>
          <div>
            <RLLabel>Minimum qualifying spend ($)</RLLabel>
            <RLInput type="number" step={1} value={minSpend} onChange={(e) => setMinSpend(parseFloat(e.target.value || "0"))} />
          </div>
        </Row>
        <Row>
          <div>
            <RLLabel>Per transaction cap (pts)</RLLabel>
            <RLInput type="number" value={caps.perTxn} onChange={(e) => setCaps({ ...caps, perTxn: parseInt(e.target.value || "0", 10) })} />
          </div>
          <div>
            <RLLabel>Per day per guest cap (pts)</RLLabel>
            <RLInput type="number" value={caps.perDay} onChange={(e) => setCaps({ ...caps, perDay: parseInt(e.target.value || "0", 10) })} />
          </div>
        </Row>
        <Divider />
        <div>
          <h3 className="font-medium mb-2 text-gray-800">Accrual channels</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(channels).map(([k, val]) => (
              <label key={k} className="flex items-center gap-2 text-sm bg-white p-2 rounded-lg border border-gray-200">
                <Switch checked={val as boolean} onCheckedChange={(v) => setChannels({ ...channels, [k]: v } as ChannelMap)} />
                <span className="capitalize">{k}</span>
              </label>
            ))}
          </div>
        </div>
        <Divider />
        <div>
          <h3 className="font-medium mb-2 text-gray-800">Item‑level overrides (earn % vs base)</h3>
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(overrides).map(([k, v]) => (
              <div key={k} className="bg-white p-3 rounded-lg border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">{MOCK_CATEGORIES.find(c => c.id === (k as CategoryId))?.name || k}</div>
                <RLInput type="number" value={v} onChange={(e) => setOverrides({ ...overrides, [k as CategoryId]: parseInt(e.target.value || "0", 10) })} />
                <div className="text-[11px] text-gray-500 mt-1">e.g., -50 means half the base earn</div>
              </div>
            ))}
          </div>
        </div>
        <Divider />
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-800">Welcome bonus (on join)</div>
          <Switch checked={wel.enabled} onCheckedChange={(v) => setWel({ ...wel, enabled: v })} />
        </div>
        <div className="mt-3 grid md:grid-cols-3 gap-3">
          <div>
            <RLLabel>Bonus points</RLLabel>
            <RLInput type="number" value={wel.bonusPoints} onChange={(e) => setWel({ ...wel, bonusPoints: parseInt(e.target.value || "0", 10) })} />
          </div>
          <div className="text-xs text-gray-500 md:col-span-2 flex items-end">Awarded once on successful account creation (email/mobile verified). No spend threshold.</div>
        </div>
      </div>

      {/* Redemption & Expiry */}
      <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 mt-4 shadow-[inset_4px_0_0_0_rgba(99,102,241,0.85)]">
        <div className="flex items-center gap-2 mb-1">
          <div className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">Redemption</div>
          <span className="text-[12px] text-indigo-700">How points are spent & when they expire</span>
        </div>
        <p className="text-xs text-gray-600 mb-3">Choose redemption blocks, enable split tender, tune category multipliers, and set rolling expiry.</p>
        <Row>
          <div>
            <RLLabel>Redemption increment (pts)</RLLabel>
            <RLInput type="number" value={increment} onChange={(e) => setIncrement(parseInt(e.target.value || "0", 10))} />
            <div className="text-[11px] text-gray-500 mt-1">Each {increment} pts ≈ ${(increment * cfg.basics.pointValue).toFixed(2)} credit</div>
          </div>
          <div className="flex items-end gap-6">
            <label className="flex items-center gap-2"><Switch checked={allowPartial} onCheckedChange={setAllowPartial} /><span className="text-sm">Allow partial pay with points</span></label>
            <label className="flex items-center gap-2"><Switch checked={allowSplit} onCheckedChange={setAllowSplit} /><span className="text-sm">Allow split tender</span></label>
          </div>
        </Row>
        <Divider />
        <div>
          <h3 className="font-medium mb-2 text-gray-800">Category multipliers (× points)</h3>
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(mx).map(([k, v]) => (
              <div key={k} className="bg-white p-3 rounded-lg border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">{MOCK_CATEGORIES.find(c => c.id === (k as CategoryId))?.name || k}</div>
                <RLInput type="number" step={0.1} value={v} onChange={(e) => setMx({ ...mx, [k as CategoryId]: parseFloat(e.target.value || "0") })} />
                <div className="text-[11px] text-gray-500 mt-1">0.6× = cheaper in points; 1.5× = pricier</div>
              </div>
            ))}
          </div>
        </div>
        <Divider />
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <RLLabel>Expire after (months of inactivity)</RLLabel>
            <RLInput type="number" min={1} value={months} onChange={(e) => setMonths(parseInt(e.target.value || "0", 10))} />
          </div>
          <div>
            <RLLabel>Grace email (days before expiry)</RLLabel>
            <RLInput type="number" min={0} value={grace} onChange={(e) => setGrace(parseInt(e.target.value || "0", 10))} />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm"><Switch checked={autoExtend} onCheckedChange={setAutoExtend} />Auto‑extend on activity</label>
      </div>

      {/* Program Cost Estimator */}
      <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 mt-4">
        <div className="text-sm font-medium text-gray-800 mb-2">Program cost estimator</div>
        <Row>
          <div>
            <RLLabel>Assumed redemption rate (%)</RLLabel>
            <RLInput type="number" value={assumedRedemption} onChange={(e) => setAssumedRedemption(parseFloat(e.target.value || "0"))} />
          </div>
          <div>
            <RLLabel>Assumed expiry/breakage (%)</RLLabel>
            <RLInput type="number" value={assumedExpiry} onChange={(e) => setAssumedExpiry(parseFloat(e.target.value || "0"))} />
          </div>
        </Row>
        <div className="text-sm text-gray-700 mt-3">Estimated program cost ≈ <b>{estProgramCostPct.toFixed(1)}%</b> of sales (based on points per $ and $/pt).
          <div className="text-xs text-gray-600">Note: This is a budgeting aid. Actuals vary with category multipliers, exclusions, increments, and guest behavior.</div>
        </div>
      </div>

      <Divider />
      <PrimaryButton onClick={() => setCfg((c) => ({
        ...c,
        earn: { ...c.earn, ptsPerDollar: rate, minSpend, caps, channels, itemOverrides: overrides, welcome: wel },
        redeem: { ...c.redeem, allowPartial, allowSplitTender: allowSplit, increment, multipliers: mx },
        expiry: { ...c.expiry, months, graceEmailDays: grace, autoExtend }
      }))}>Save program rules</PrimaryButton>
    </section>
  );
}

function Eligibility({ cfg, setCfg }: PaneProps): JSX.Element {
  const [scope, setScope] = useState<EligibilityConfig["scope"]>(cfg.eligibility.scope);
  const [cats, setCats] = useState<CategoryId[]>(cfg.eligibility.categories);
  const [prods, setProds] = useState<string[]>(cfg.eligibility.products);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [ex, setEx] = useState<string>(cfg.redeem.exclusions.join(", "));

  return (
    <section>
      <h2 className="text-xl font-semibold mb-1 text-gray-800">Eligible items</h2>
      <p className="text-sm text-gray-600 mb-6">Choose which products can earn/redeem points. Add exclusions here.</p>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={scope === "categories"} onChange={() => setScope("categories")} />Use categories</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={scope === "products"} onChange={() => setScope("products")} />Select specific products</label>
      </div>

      {scope === "categories" ? (
        <div className="grid md:grid-cols-3 gap-3 mt-4">
          {MOCK_CATEGORIES.map(c => (
            <label key={c.id} className="flex items-center gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200 text-sm">
              <input type="checkbox" checked={cats.includes(c.id)} onChange={(e) => setCats(e.target.checked ? [...cats, c.id] : cats.filter(x => x !== c.id))} />
              {c.name}
            </label>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger asChild><OutlineButton>Open product picker</OutlineButton></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Select products</DialogTitle>
                <DialogDescription>Mocked list based on your current VM.</DialogDescription>
              </DialogHeader>
              <div className="grid md:grid-cols-2 gap-2 mt-2">
                {MOCK_PRODUCTS.map(p => (
                  <label key={p.id} className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200 text-sm">
                    <input type="checkbox" checked={prods.includes(p.id)} onChange={(e) => setProds(e.target.checked ? [...prods, p.id] : prods.filter(x => x !== p.id))} />
                    <span>{p.name}</span>
                    <span className="ml-auto text-xs text-gray-500">{MOCK_CATEGORIES.find(c => c.id === p.category)?.name}</span>
                  </label>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          {prods.length > 0 && (<div className="text-xs text-gray-600 mt-3">Selected: {prods.length} products</div>)}
        </div>
      )}

      <Divider />
      <div>
        <RLLabel>Exclusions (comma‑separated)</RLLabel>
        <RLInput value={ex} onChange={(e) => setEx(e.target.value)} />
        <div className="text-[11px] text-gray-500 mt-1">e.g., gift cards, third‑party vouchers</div>
      </div>

      <Divider />
      <PrimaryButton onClick={() => setCfg((c) => ({ ...c, eligibility: { ...c.eligibility, scope, categories: cats, products: prods }, redeem: { ...c.redeem, exclusions: ex.split(",").map(s => s.trim()).filter(Boolean) } }))}>Save eligibility</PrimaryButton>
    </section>
  );
}

function Review({ cfg, setPublished }: { cfg: Config; setPublished: Dispatch<SetStateAction<boolean>> }): JSX.Element {
  const [agree, setAgree] = useState<boolean>(false);
  const redeemExample = useMemo(() => {
    const price = 15; // $15 session pass
    const basePts = Math.round((price / cfg.basics.pointValue));
    const ptsWithMx = Math.round(basePts * cfg.redeem.multipliers.session / cfg.redeem.increment) * cfg.redeem.increment;
    return { price, basePts, ptsWithMx };
  }, [cfg]);

  const publish = (): void => setPublished(true);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-1 text-gray-800">Review & publish</h2>
      <p className="text-sm text-gray-600 mb-6">Confirm your policy version. You can edit later; the ledger keeps a full history.</p>

      <div className="grid md:grid-cols-2 gap-4">
        <SummaryCard title="Program rules — Earn" lines={[`Base: ${cfg.earn.ptsPerDollar} pts/$`, `Min spend: $${cfg.earn.minSpend}`, `Caps: ${cfg.earn.caps.perTxn.toLocaleString()} / ${cfg.earn.caps.perDay.toLocaleString()} pts`, `Channels: ${Object.entries(cfg.earn.channels).filter(([_,v])=>v).map(([k])=>k).join(", ") || "—"}`, `${cfg.earn.welcome.enabled ? `Welcome bonus: ${cfg.earn.welcome.bonusPoints} pts` : "Welcome bonus: OFF"}`]} />
        <SummaryCard title="Program rules — Redeem & expiry" lines={[`Point value: $${cfg.basics.pointValue.toFixed(2)}/pt`, `Increment: ${cfg.redeem.increment} pts`, `Multipliers: session ${cfg.redeem.multipliers.session}×, stock ${cfg.redeem.multipliers.stock}×`, `Exclusions: ${cfg.redeem.exclusions.join(", ")}`, `Expiry: ${cfg.expiry.months} months; grace ${cfg.expiry.graceEmailDays} days; auto-extend ${cfg.expiry.autoExtend ? "on" : "off"}`]} />
        <SummaryCard title="Eligible items" lines={[cfg.eligibility.scope === "categories" ? `Categories: ${cfg.eligibility.categories.map((c)=>MOCK_CATEGORIES.find(x=>x.id===c)?.name).join(", ")}` : `Products: ${cfg.eligibility.products.length} selected`]} />
      </div>

      <div className="mt-4 text-sm text-gray-600">
        Example: A $15 session pass costs <b>{redeemExample.basePts.toLocaleString()}</b> pts at face value; with a <b>{cfg.redeem.multipliers.session}×</b> session multiplier it becomes <b>{redeemExample.ptsWithMx.toLocaleString()}</b> pts.
      </div>

      <Divider />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I confirm program terms are reviewed with finance.</label>
      <div className="flex gap-2 mt-3">
        <PrimaryButton disabled={!agree} onClick={publish}>Publish program</PrimaryButton>
        <OutlineButton onClick={() => navigator.clipboard?.writeText(JSON.stringify(cfg, null, 2))}>Copy JSON</OutlineButton>
      </div>
    </section>
  );
}

function SummaryCard({ title, lines }: { title: string; lines: string[] }): JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 p-4 bg-white">
      <div className="text-sm font-semibold mb-2 text-gray-800">{title}</div>
      <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}
