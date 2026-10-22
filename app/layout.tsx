import "./globals.css";
import { Fredoka, JetBrains_Mono, Nunito } from "next/font/google";
import { cn } from "@/lib/utils";
import { WalletProvider } from "@/components/wallet-provider";

const display = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = Nunito({ subsets: ["latin"], variable: "--font-body" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata = {
  title: "Proof of Promise",
  description: "Put money on your promises. Swappy, the agent, checks the proof. Runs on Base Sepolia testnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans antialiased", display.variable, body.variable, jetBrainsMono.variable)}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
