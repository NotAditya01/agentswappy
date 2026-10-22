import { WalletButton } from "@/components/wallet-button";

export function SiteHeader() {
  return (
    <header className="flex h-16 items-center justify-between border-b">
      <a href="/" className="flex items-center gap-2.5 text-sm font-medium">
        <img src="/logo.png" alt="" width={24} height={24} className="size-6 rounded-[5px] ring-1 ring-white/15" />
        Proof of Promise
      </a>
      <WalletButton />
    </header>
  );
}
