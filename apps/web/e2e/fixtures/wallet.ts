import { test as base, Page } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { normalizeAddress } from '../../lib/chain';

export const TEST_OWNER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

export interface WalletFixture {
  ownerAccount: ReturnType<typeof privateKeyToAccount>;
  ownerAddress: string;
  injectMockWallet: (page: Page) => Promise<void>;
}

export const test = base.extend<{ wallet: WalletFixture }>({
  wallet: async ({}, use) => {
    const ownerAccount = privateKeyToAccount(TEST_OWNER_PRIVATE_KEY);
    const ownerAddress = normalizeAddress(ownerAccount.address);

    const injectMockWallet = async (page: Page) => {
      await page.exposeFunction('__mockSignMessage', async (rawMsg: string) => {
        let msg = rawMsg;
        if (typeof rawMsg === 'string' && rawMsg.startsWith('0x')) {
          try {
            msg = Buffer.from(rawMsg.slice(2), 'hex').toString('utf8');
          } catch {
            msg = rawMsg;
          }
        }
        return await ownerAccount.signMessage({ message: msg });
      });

      await page.addInitScript((addr: string) => {
        const listeners: Record<string, Function[]> = {};

        const provider = {
          isMetaMask: true,
          chainId: '0xa869',
          networkVersion: '43113',
          selectedAddress: addr,
          async request({ method, params }: { method: string; params?: any[] }) {
            switch (method) {
              case 'eth_requestAccounts':
              case 'eth_accounts':
                return [addr];
              case 'eth_chainId':
                return '0xa869';
              case 'net_version':
                return '43113';
              case 'personal_sign': {
                const rawMsg =
                  params?.[0]?.startsWith('0x') && params?.[1]?.toLowerCase() === addr.toLowerCase()
                    ? params[0]
                    : params?.[1]?.startsWith('0x') && params?.[0]?.toLowerCase() === addr.toLowerCase()
                    ? params[1]
                    : params?.[0];
                return await (window as any).__mockSignMessage(rawMsg);
              }
              default:
                throw new Error(`Unsupported method: ${method}`);
            }
          },
          on(event: string, fn: Function) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
          },
          removeListener(event: string, fn: Function) {
            if (listeners[event]) {
              listeners[event] = listeners[event].filter((cb: Function) => cb !== fn);
            }
          },
        };

        (window as any).ethereum = provider;
      }, ownerAddress);
    };

    await use({ ownerAccount, ownerAddress, injectMockWallet });
  },
});

export { expect } from '@playwright/test';
