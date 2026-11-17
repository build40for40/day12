function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>
body { margin: 0; padding: 3rem 1.25rem; font: 1.0625rem/1.5 system-ui, sans-serif; color: #1c1b1a; background: #fffdf7; }
main { max-width: 28rem; margin: 0 auto; }
h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 1rem; }
button { font: inherit; font-weight: 600; padding: 0.75rem 1.25rem; border: 0; border-radius: 0.5rem; color: #fffdf7; background: #1c1b1a; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

export const confirmedPage = () =>
  page("You're in!", '<p>Thanks for confirming. The next daily brief of hopeful AI stories is heading for your inbox.</p>')

export const brokenLinkPage = () =>
  page("That link didn't work", "<p>It might be old, or a bit of it went missing on the way. Sign up again and we'll send you a fresh one.</p>", 404)

export const unsubscribePage = (token: string) =>
  page(
    'Off so soon?',
    `<p>Hit the button and we'll stop sending you the daily brief. No hard feelings.</p>
<form method="post" action="/unsubscribe?token=${token}"><button type="submit">Unsubscribe me</button></form>`,
  )

export const unsubscribedPage = () =>
  page("You're unsubscribed", "<p>That's done, no more emails from us. If you ever miss the good news, you can sign up again any time.</p>")
