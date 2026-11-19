// Satori's text engine and the JPEG encoder both read self.location when they load, and a Worker has none.
// Import this before them: modules run in import order, so this has set it by the time theirs do.
const scope = globalThis as { location?: { href: string } }
scope.location ??= { href: 'https://localhost/' }
export {}
