const story = {
  date: '17 November 2026',
  line: 'Dublin is piloting an AI flood warning that, in tests on past storms, flagged some floods 13 hours early.',
  place: 'Dublin, Ireland',
}

const styles = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 14px;
  background: #D9D6CE;
  color: #1C1B19;
  font-family: 'EB Garamond', Georgia, 'Times New Roman', serif;
}
a { color: inherit; }
a:hover { color: #55524B; }
:focus-visible { outline: 2px solid #1C1B19; outline-offset: 3px; }
.sheet {
  max-width: 560px;
  min-height: calc(100vh - 28px);
  min-height: calc(100svh - 28px);
  margin: 0 auto;
  padding: 30px 28px 26px;
  background: #F6F4EE;
  box-shadow: 0 1px 2px rgba(28, 27, 25, 0.25);
  display: flex;
  flex-direction: column;
}
.masthead {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px 16px;
  font-size: 17px;
}
.masthead h1 { margin: 0; font-size: inherit; font-weight: 400; font-style: italic; }
.story { margin-top: clamp(72px, 16vh, 150px); }
.story p { margin: 0; font-size: clamp(31px, 8.6vw, 40px); line-height: 1.2; letter-spacing: -0.005em; }
.story hr { width: 40px; margin: 26px 0; border: 0; border-top: 1px solid #1C1B19; }
.story .place { font-size: 17px; font-style: italic; }
.join { margin-top: clamp(64px, 14vh, 130px); display: flex; flex-direction: column; gap: 28px; }
.join .pitch { margin: 0; font-size: 22px; line-height: 1.35; }
.join form { display: flex; flex-direction: column; gap: 18px; }
.join label { display: block; font-size: 16px; font-style: italic; }
.join input[type='email'] {
  width: 100%;
  height: 48px;
  padding: 0;
  font: inherit;
  font-size: 22px;
  color: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #1C1B19;
  border-radius: 0;
}
.join input[type='email']::placeholder { color: #6B675F; }
.join input[type='email']:focus-visible { outline: 0; border-bottom-width: 2px; }
.join button {
  height: 54px;
  font: inherit;
  font-size: 20px;
  font-weight: 500;
  color: #F6F4EE;
  background: #1C1B19;
  border: 0;
  border-radius: 0;
  cursor: pointer;
}
.join button:hover { background: #3A3833; }
.join .small { margin: 0; font-size: 16px; line-height: 1.4; }
.join .error { margin: 0; font-size: 17px; font-style: italic; }
.join .joined { margin: 0; font-size: 28px; line-height: 1.25; }
.join button:disabled { opacity: 0.6; cursor: progress; }
[hidden] { display: none !important; }
footer { margin-top: auto; padding-top: 48px; font-size: 15px; }
`

const signupScript = `
const form = document.querySelector('.join form')
const error = document.getElementById('email-error')
const email = document.getElementById('email')
const button = form.querySelector('button')
const messages = {
  invalid_email: "That email doesn't look right. Check it and try again.",
  other: "We couldn't sign you up just now. Try again in a minute.",
}
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  error.hidden = true
  email.removeAttribute('aria-invalid')
  button.disabled = true
  let problem = 'other'
  try {
    const response = await fetch(form.action, { method: 'POST', body: new URLSearchParams({ email: email.value }) })
    const result = await response.json()
    if (result.ok) {
      form.hidden = true
      document.querySelector('.join .joined').hidden = false
      return
    }
    if (result.error === 'invalid_email') problem = 'invalid_email'
  } catch {}
  button.disabled = false
  error.textContent = messages[problem]
  error.hidden = false
  if (problem === 'invalid_email') email.setAttribute('aria-invalid', 'true')
})
`

export function renderLanding(signupsPath: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feel good AI stories</title>
<meta name="description" content="Daily positive AI news you can read in 10 seconds.">
<meta property="og:title" content="Feel good AI stories">
<meta property="og:description" content="Daily positive AI news you can read in 10 seconds.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
<style>${styles}</style>
</head>
<body>
  <main class="sheet">
    <header class="masthead">
      <h1>Feel good AI stories</h1>
      <div>${story.date}</div>
    </header>
    <article class="story">
      <p>${story.line}</p>
      <hr>
      <div class="place">${story.place}</div>
    </article>
    <section class="join">
      <p class="pitch">Daily positive AI news you can read in 10 seconds</p>
      <form method="post" action="${signupsPath}">
        <div>
          <label for="email">Your email</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" aria-describedby="email-error">
        </div>
        <p class="error" id="email-error" role="alert" hidden></p>
        <button type="submit">Send me tomorrow's story</button>
        <p class="small">Free. 6am UK time. Leave whenever you like.</p>
      </form>
      <p class="joined" role="status" hidden>Check your inbox. One click to confirm and you're in.</p>
    </section>
    <footer>Day 12 of <a href="https://build40for40.com">40 for 40</a></footer>
  </main>
  <script>${signupScript}</script>
</body>
</html>
`
}
