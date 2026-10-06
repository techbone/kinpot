import { boolean, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

import type { Bill } from "../bill";

/** Off-chain context for a pot. `bill` hashes to the onchain `billHash`; the API rejects anything else. */
export const pots = pgTable(
  "pots",
  {
    /** `${chainId}:${kinpotAddress}`, see scopeOf. */
    scope: text("scope").notNull(),
    potId: text("pot_id").notNull(),
    slug: text("slug").notNull().unique(),
    bill: jsonb("bill").$type<Bill>().notNull(),
    billHash: text("bill_hash").notNull(),
    organizer: text("organizer").notNull(),
    payee: text("payee").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.potId] })],
);

/** Links a named share ("Kemi: $150") to the address that paid it. Signed by that address. */
export const shareClaims = pgTable(
  "share_claims",
  {
    scope: text("scope").notNull(),
    potId: text("pot_id").notNull(),
    shareIndex: integer("share_index").notNull(),
    address: text("address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.potId, t.shareIndex] })],
);

/** Schools, hospitals and landlords that can receive payments. `verified` is set by Kinpot. */
export const payees = pgTable("payees", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  city: text("city").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Display names for addresses, so the family sees "Kemi" instead of 0x26…5030. */
export const profiles = pgTable("profiles", {
  address: text("address").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pots (
  scope text NOT NULL,
  pot_id text NOT NULL,
  slug text NOT NULL UNIQUE,
  bill jsonb NOT NULL,
  bill_hash text NOT NULL,
  organizer text NOT NULL,
  payee text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, pot_id)
);
CREATE INDEX IF NOT EXISTS pots_organizer ON pots (organizer);
CREATE INDEX IF NOT EXISTS pots_payee ON pots (payee);
CREATE TABLE IF NOT EXISTS share_claims (
  scope text NOT NULL,
  pot_id text NOT NULL,
  share_index integer NOT NULL,
  address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, pot_id, share_index)
);
CREATE TABLE IF NOT EXISTS payees (
  id serial PRIMARY KEY,
  address text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  city text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
  address text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
