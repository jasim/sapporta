---
"@sapporta/core": minor
---

`pnpm dev` now prints both of a project's development URLs as it starts, and
`sapporta init` prints the same pair when it finishes. Each project has had its
own random ports since they stopped being fixed at 3000 and 5173, but a reader
had to find them: the frontend URL arrived in Vite's banner, the API reported a bare
port number several seconds later among the compiler output, and neither said
where the numbers came from. Each line now names what its URL is for — the App
URL to open in a browser, the API URL to call directly from scripts and coding
agents — and both name `.env.development` as the file that holds them. The API's
own ready line reports a URL rather than a bare port.
