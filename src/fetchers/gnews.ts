import type { RawItem } from '../types'

// Google News truncates long queries from the end, so the date filter goes first.
export function gnewsUrl(query: string): string {
  const q = encodeURIComponent(`when:2d ${query}`)
  return `https://news.google.com/rss/search?q=${q}&hl=en-GB&gl=GB&ceid=GB:en`
}

export function cleanGnewsItems(items: RawItem[]): RawItem[] {
  return items.map((item) => {
    const { title, publisher } = splitPublisher(item.title, item.publisher)
    return publisher ? { ...item, title, publisher } : { ...item, title }
  })
}

function splitPublisher(title: string, publisher?: string): { title: string; publisher?: string } {
  if (publisher) {
    const suffix = ` - ${publisher}`
    return title.endsWith(suffix) ? { title: title.slice(0, -suffix.length).trim(), publisher } : { title, publisher }
  }
  const cut = title.lastIndexOf(' - ')
  if (cut <= 0) return { title }
  return { title: title.slice(0, cut).trim(), publisher: title.slice(cut + 3).trim() }
}
