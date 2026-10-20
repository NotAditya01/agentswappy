"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPublicClient, formatUnits, getAddress, http, type Address } from "viem";
import { chain, USDC_ADDRESS, usdcAbi } from "@/lib/escrow";

type WalletState = {
  installed: boolean;
  account: Address | null;
  chainId: number | null;
  usdc: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<Address | null>;
  refreshBalance: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);
const reader = createPublicClient({ chain, transport: http() });
const CHAIN_HEX = `0x${chain.id.toString(16)}`;

async function ensureBaseSepolia() {
  const eth = window.ethereum!;
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (parseInt(current, 16) === chain.id) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (err) {
    if ((err as { code?: number })?.code !== 4902) throw err;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: "Base Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"],
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        },
      ],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBalance = useCallback(async (address: Address | null) => {
    if (!address) return setUsdc(null);
    try {
      const raw = await reader.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: "balanceOf", args: [address] });
      setUsdc(formatUnits(raw, 6));
    } catch {
      setUsdc(null);
    }
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    setInstalled(Boolean(eth));
    if (!eth) return;

    // Pick up a wallet that is already connected, without a prompt.
    eth.request({ method: "eth_accounts" }).then((list) => {
      const first = (list as string[])[0];
      if (first) setAccount(getAddress(first));
    }).catch(() => undefined);
    eth.request({ method: "eth_chainId" }).then((id) => setChainId(parseInt(id as string, 16))).catch(() => undefined);

    const onAccounts = (list: string[]) => setAccount(list[0] ? getAddress(list[0]) : null);
    const onChain = (id: string) => setChainId(parseInt(id, 16));
    eth.on?.("accountsChanged", onAccounts as never);
    eth.on?.("chainChanged", onChain as never);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts as never);
      eth.removeListener?.("chainChanged", onChain as never);
    };
  }, []);

  useEffect(() => {
    loadBalance(account);
  }, [account, chainId, loadBalance]);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return null;
    setConnecting(true);
    setError(null);
    try {
      const list = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!list[0]) throw new Error("The wallet did not share an address.");
      await ensureBaseSepolia();
      const address = getAddress(list[0]);
      setAccount(address);
      setChainId(chain.id);
      return address;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const refreshBalance = useCallback(() => loadBalance(account), [account, loadBalance]);

  return (
    <WalletContext.Provider value={{ installed, account, chainId, usdc, connecting, error, connect, refreshBalance }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider.");
  return value;
}
