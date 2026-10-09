/**
 * Ideator constraints enforced in code (the LLM check is additive, never a substitute).
 * - ticker ≤ 6 chars, A–Z0–9 only
 * - no real person's name (deny-list here; LLM check in ideator.ts)
 * - no protected brand / character
 */

import type { Identity } from "@quantagent/core/types";

export const TICKER_MAX = 6;
export const TICKER_RE = /^[A-Z0-9]{1,6}$/;

/** Well-known real people. Matched as whole words, case-insensitive, on name and ticker. */
export const REAL_PERSON_DENY: readonly string[] = [
  "elon", "musk", "trump", "biden", "obama", "putin", "zelensky", "kanye", "ye west",
  "taylor swift", "swift", "beyonce", "drake", "rihanna", "kardashian", "jenner", "bezos",
  "zuckerberg", "zuck", "gates", "vitalik", "buterin", "satoshi", "cz", "changpeng",
  "sbf", "bankman", "ansem", "cobie", "murad", "andrew tate", "tate", "mrbeast", "logan paul",
  "jake paul", "pewdiepie", "xqc", "kai cenat", "ishowspeed", "messi", "ronaldo", "lebron",
  "jordan", "mbappe", "neymar", "federer", "nadal", "djokovic", "oprah", "snoop", "eminem",
  "jay-z", "jayz", "travis scott", "justin bieber", "bieber", "selena", "ariana", "billie eilish",
  "bad bunny", "dua lipa", "harry styles", "macron", "modi", "xi jinping", "kim jong",
  "erdogan", "netanyahu", "milei", "bukele", "sam altman", "altman", "dario", "amodei",
  "jensen", "huang", "tim cook", "sundar", "pichai", "nadella", "dorsey", "pavel durov", "durov",
  "roaring kitty", "keith gill", "cathie wood", "michael saylor", "saylor", "warren buffett", "buffett",
  "charlie munger", "munger", "pelosi", "aoc", "ocasio", "desantis", "newsom", "rfk", "kennedy",
  "harris", "kamala", "vance", "walz", "hillary", "clinton", "bernie", "sanders",
];

/** Protected brands, franchises and characters. */
export const PROTECTED_BRAND_DENY: readonly string[] = [
  "disney", "mickey", "minnie", "pixar", "marvel", "spider-man", "spiderman", "iron man",
  "batman", "superman", "dc comics", "star wars", "darth", "yoda", "baby yoda", "grogu",
  "pokemon", "pikachu", "charizard", "nintendo", "mario", "luigi", "zelda", "kirby", "sonic",
  "minecraft", "fortnite", "roblox", "lego", "barbie", "hello kitty", "sanrio", "peppa",
  "paw patrol", "spongebob", "simpsons", "homer", "bart", "family guy", "rick and morty",
  "south park", "shrek", "minions", "despicable", "frozen", "elsa", "harry potter", "hogwarts",
  "lord of the rings", "hobbit", "gandalf", "game of thrones", "stranger things", "squid game",
  "naruto", "goku", "dragon ball", "one piece", "luffy", "attack on titan", "demon slayer",
  "mcdonalds", "mcdonald's", "ronald mcdonald", "burger king", "starbucks", "coca-cola", "coca cola",
  "coke", "pepsi", "nike", "adidas", "apple", "iphone", "google", "microsoft", "windows", "xbox",
  "playstation", "sony", "samsung", "tesla", "spacex", "amazon", "netflix", "spotify",
  "facebook", "meta", "instagram", "tiktok", "snapchat", "twitter", "x corp", "openai", "chatgpt",
  "anthropic", "claude", "nvidia", "intel", "amd", "ferrari", "lamborghini", "porsche", "bmw",
  "mercedes", "toyota", "honda", "gucci", "prada", "louis vuitton", "chanel", "rolex", "supreme",
  "red bull", "monster energy", "doritos", "oreo", "kfc", "wendy's", "wendys", "taco bell",
  "walmart", "costco", "ikea", "visa", "mastercard", "paypal", "coinbase", "binance", "kraken",
  "solana", "ethereum", "bitcoin", "dogecoin", "doge", "shiba", "bonk", "wif", "pepe",
  "nfl", "nba", "fifa", "uefa", "olympics", "superbowl", "super bowl",
];

function wordHit(text: string, term: string): boolean {
  const t = text.toLowerCase();
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(t);
}

export function findDenied(text: string, list: readonly string[]): string | undefined {
  return list.find((term) => wordHit(text, term));
}

/** Returns an empty array when the identity passes every in-code constraint. */
export function checkIdentityConstraints(identity: Identity): string[] {
  const violations: string[] = [];
  const ticker = identity.ticker.trim();
  if (ticker.length === 0) violations.push("ticker is empty");
  else if (ticker.length > TICKER_MAX) violations.push(`ticker "${ticker}" is longer than ${TICKER_MAX} chars`);
  else if (!TICKER_RE.test(ticker)) violations.push(`ticker "${ticker}" must be A–Z/0–9 only`);

  const name = identity.name.trim();
  if (name.length === 0) violations.push("name is empty");
  if (name.length > 32) violations.push(`name "${name}" is longer than 32 chars (pump.fun limit)`);

  for (const field of [name, ticker] as const) {
    const person = findDenied(field, REAL_PERSON_DENY);
    if (person) violations.push(`"${field}" references a real person (${person})`);
    const brand = findDenied(field, PROTECTED_BRAND_DENY);
    if (brand) violations.push(`"${field}" references a protected brand (${brand})`);
  }
  return violations;
}
