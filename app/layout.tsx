import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { WalletProvider } from "@/components/wallet-provider";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata = {
  title: "Proof of Promise",
  description: "Put money on your promises. Swappy, the agent, checks the proof. Runs on Base Sepolia testnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans antialiased", sans.variable, mono.variable)}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
