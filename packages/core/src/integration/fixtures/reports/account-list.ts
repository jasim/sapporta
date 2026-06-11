import { report } from "@sapporta/server/report";

export default report({
  name: "account-list",
  label: "Account List",
  params: [
    { name: "type", type: "string", required: false, label: "Account Type" },
  ],
  sources: {
    accounts: {
      // SQLite doesn't need type casts — parameters are dynamically typed.
      // COALESCE handles NULL balance values; CAST to INTEGER for consistency.
      query: "SELECT name, type, CAST(COALESCE(balance, 0) AS INTEGER) AS balance FROM accounts WHERE ($type IS NULL OR type = $type) ORDER BY name",
    },
  },
  tree: {
    source: "accounts",
    levelName: "account",
    columns: [
      { name: "name", label: "Name" },
      { name: "type", label: "Type" },
      { name: "balance", label: "Balance" },
    ],
  },
});
