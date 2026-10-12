# Metropolis submission text

Copy each block into the matching field of the submission form.

## Project name

Kinpot

## One-liner

Pay the bill, not the person: siblings abroad pool AUSD for a family bill, and it goes straight to the school, hospital or landlord.

## Track

Consumer Products & Payments

## Description

Nigerians abroad send billions home each year, and much of it is meant for one specific bill: school fees, a hospital invoice, the rent. Today it travels through a relative, which is where money gets delayed, diverted or lost to fake fee notices. When several siblings split a bill, it's three transfers to one person, a spreadsheet in the family WhatsApp group, and trust.

Kinpot makes the bill itself the payment. Someone starts a pot for one bill: a named payee, an amount, a due date. Siblings chip in from anywhere with Face ID, in AUSD on Monad. The money waits in the contract, where nobody can spend it, and is paid out only when three things are true: the pot is fully funded, **the payee has confirmed the bill is real**, and the due date has arrived. Then the full amount goes straight to the school. If the payee declines, never confirms, or the bill isn't paid by the refund date, every sibling gets back exactly what they put in, automatically.

There is no seed phrase and no gas token for anyone. Family and payees sign in with a passkey (Mera). A contribution is a single EIP-3009 signature on AUSD, bound to that pot, which our relayer submits and pays gas for. The relayer can never move anyone's money.

Because the payee confirms first, a fake invoice can't collect a cent. Because the contract holds the rules, nobody in the middle can redirect the money, not even us: there is no admin key, no pause, no upgrade.

## What we built during the hackathon

- **`Kinpot` contract:** per-pot escrow with fund, confirm, decline, cancel, release, refund and a pull-refund fallback. 100% line coverage, fuzz and invariant tests, fork tests against the real AUSD, `forge lint` clean. No privileged roles.
- **`KinpotAutomation`:** Chainlink CRE receiver that pays due pots and refunds expired ones.
- **Web app** (Next.js): passkey sign-in, gasless contributions, pot pages designed for a phone, a payee inbox, a verified payee directory, naira estimates, WhatsApp sharing, and an "add money" link through Ramp.
- **Relayer:** simulates every call, sizes gas tightly for Monad, and enforces daily per-address and total budgets.
- **Envio indexer:** pots, participants and a full activity feed with a receipt for every step, on both networks.
- **Chainlink CRE workflow:** a cron workflow that reads what's due and writes a signed report. Simulated with `--broadcast` on Monad testnet, where it paid a real pot.

## Bounties and integrations

- **Agora (AUSD):** the only token Kinpot moves, on mainnet. Uses `receiveWithAuthorization` for one-signature payments.
- **Monad Foundation, Mera UX and Mera Passkeys:** passkey-derived accounts for every user, with no wallet install.
- **Chainlink (CRE):** the keeper workflow and receiver contract. Simulated onchain; deployment access requested.
- **Envio:** HyperIndex on Monad mainnet and testnet for the activity feed and "pots I've paid into".

## Links

- Live app: https://kinpot.vercel.app
- Code: https://github.com/techbone/kinpot
- Architecture: https://github.com/techbone/kinpot/blob/main/ARCHITECTURE.md
- Mainnet `Kinpot`: https://monadscan.com/address/0x335793390Bce6c2f74d45bFB8b78C6691aAf55c3
- A real mainnet payment: https://kinpot.vercel.app/p/uj3qfpuk
- Indexer: https://indexer.dev.hyperindex.xyz/44fb53d/v1/graphql
- Demo video: _add link_

## Honest limits and what's next

- Payees receive AUSD. Naira payout through a licensed partner is the next step, so the school or landlord sees money in a bank account.
- The Chainlink workflow is proven by simulation. Continuous deployment is waiting on Chainlink's access approval; until then `/api/keeper` and the in-app "Pay now" button make the same call.
- Payee verification is manual. Next: schools issue a Kinpot link per student, with checks against company registration.
- Unaudited. Please treat it as hackathon software.
