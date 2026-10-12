# Kinpot demo script (2:45)

One continuous story: a family pays a school bill. Two screens: a **phone** (Kemi, a sibling abroad) and a **laptop** (Tobi, who starts the pot, then the school bursary).

## Before you record

- [ ] Use **Testnet** for the live walkthrough (free, repeatable). Show **Mainnet** proof at the end with monadscan links.
- [ ] Phone: signed in as **Kemi** with a passkey. Account menu → *Add $500 of test money*.
- [ ] Laptop, window 1: signed in as **Tobi** (passkey) with test money.
- [ ] Laptop, window 2 (or a second browser profile): signed in as **Grace Model College Bursary** via **For payees**. Send its address to be verified so it shows the blue badge.
- [ ] Hide notifications. Phone in light mode, laptop in dark mode looks good side by side.
- [ ] Open https://monadscan.com/address/0x335793390Bce6c2f74d45bFB8b78C6691aAf55c3 in a tab for the last scene.
- [ ] Do one dry run. Pick the amount **$10** so numbers are easy to read.

## Script

| Time | On screen | Say |
|---|---|---|
| **0:00** | Landing page, hero | "When you send money home for school fees, it goes to a relative, and then to the school. That middle step is where fees get lost, delayed, or scammed. Kinpot removes it. **Pay the bill, not the person.**" |
| **0:20** | Laptop (Tobi): **New pot**. Name it *Dayo's school fees*. Search "Grace", pick the verified school. $10, **As soon as it's covered**. Add person: Tobi $4, Kemi $6. Start. | "Tobi, in London, starts a pot for one bill. He picks the school from a directory, sets the amount, and says who is covering what. The money can only ever go to that school." |
| **0:50** | Pot page → **Share on WhatsApp**. Cut to phone opening the link. | "He drops the link in the family group. Kemi opens it on her phone." |
| **1:00** | Phone: **Sign in** (already done) → **Pay your share**, tap *Kemi*, **Pay $6.00**, Face ID. | "One tap and Face ID. No wallet, no seed phrase, no gas. Kinpot covers the network fee, and it can never touch her money." |
| **1:20** | Laptop: pot page updates, progress bar, *Kemi paid*. Tobi pays his $4 the same way. | "Everyone sees who has paid, live." |
| **1:35** | Laptop window 2 (school): **For payees** → bill addressed to the school → **Confirm bill**. | "Now the part that stops scams. The school has to confirm the bill is real before a cent moves. If it doesn't recognise it, it declines and everyone is refunded automatically." |
| **1:55** | Pot page: all three ticks. Tap **Pay now** (or show the CRE log). | "Covered, confirmed, due. Anyone can trigger the payout, so there's a Pay now button. We also built a Chainlink CRE workflow that checks every minute and pays whatever is ready. Here is the run where it paid a pot onchain." (Show the README link to the CRE transaction.) |
| **2:10** | Green banner: *$10.00 went straight to Grace Model College Bursary*. **View receipt**. Scroll to the activity feed. | "The full amount went straight to the school. Every step has a receipt, indexed by Envio." |
| **2:25** | Browser tab: monadscan, the **mainnet** pot. | "This isn't only testnet. Here is a real pot on Monad mainnet, with real AUSD, created, paid in with a passkey and no gas, confirmed and paid out. The contracts are verified." |
| **2:40** | Landing page or repo README. | "Kinpot: pay the bill, not the person. Built on Monad with AUSD, Mera passkeys, Chainlink CRE and Envio." |

## If something goes wrong while recording

- **Passkey prompt doesn't appear on the laptop:** use Safari or the iCloud Keychain option. Desktop Chrome with a local profile can't create these passkeys.
- **"Day limit" or relayer error:** the relayers hold gas for hundreds of transactions. If a send fails, wait ten seconds and tap again.
- **Pot not paying by itself:** tap **Pay now**. It's the same call the Chainlink workflow makes.
- **Keep the school confirmation visible.** It's the clearest proof of the anti-scam idea.

## Questions judges may ask

- **Where does the money sit?** In the Kinpot contract, per pot. It can only go to the payee or back to the people who paid. There is no admin key and no way to change that.
- **Why can't the payee just take it early?** The contract checks three facts itself: fully funded, payee confirmed, due date reached.
- **What if the school never confirms?** The pot expires and everyone gets back exactly what they put in.
- **Who pays gas?** A relayer, with daily limits. It can only submit signatures users made, never move funds.
- **What about naira?** Payees receive AUSD today. Naira payout through a licensed partner is the next step.
