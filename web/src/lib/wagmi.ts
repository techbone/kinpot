import { createConfig, http, injected } from "wagmi";

import { networks } from "./networks";

/** wagmi only handles injected wallets here. Reads use plain viem clients, and every write
 *  goes through the relayer as a signature, so nothing here sends transactions. */
export const wagmiConfig = createConfig({
  chains: [networks.testnet.chain, networks.mainnet.chain, networks.local.chain],
  connectors: [injected()],
  transports: {
    [networks.testnet.chain.id]: http(networks.testnet.rpc[0]),
    [networks.mainnet.chain.id]: http(networks.mainnet.rpc[0]),
    [networks.local.chain.id]: http(networks.local.rpc[0]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
