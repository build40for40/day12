import { gnewsUrl } from './fetchers/gnews'
import type { Source, Tier } from './types'

function gnews(id: string, name: string, tier: Tier, query: string): Source {
  return { id, name, type: 'gnews', url: gnewsUrl(query), tier }
}

export const SOURCES: Source[] = [
  { id: 'sciencedaily-ai', name: 'ScienceDaily AI', type: 'rss', url: 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml', tier: 'press_release' },
  { id: 'physorg-ml-ai', name: 'Phys.org ML and AI', type: 'rss', url: 'https://phys.org/rss-feed/technology-news/machine-learning-ai/', tier: 'press_release' },
  { id: 'medicalxpress-ai', name: 'Medical Xpress AI', type: 'rss', url: 'https://medicalxpress.com/rss-feed/search/?search=artificial+intelligence', tier: 'press_release' },
  { id: 'mit-news-ai', name: 'MIT News AI', type: 'rss', url: 'https://news.mit.edu/rss/topic/artificial-intelligence2', tier: 'press_release' },

  { id: 'nasa', name: 'NASA news releases', type: 'rss', url: 'https://www.nasa.gov/news-release/feed/', tier: 'organisation', keywordFilter: true },
  { id: 'nhs-england', name: 'NHS England', type: 'rss', url: 'https://www.england.nhs.uk/feed/', tier: 'organisation', keywordFilter: true },
  { id: 'govuk-ai', name: 'GOV.UK news on AI', type: 'rss', url: 'https://www.gov.uk/search/news-and-communications.atom?keywords=artificial+intelligence', tier: 'organisation', keywordFilter: true },

  { id: 'deepmind-blog', name: 'Google DeepMind blog', type: 'rss', url: 'https://deepmind.google/blog/rss.xml', tier: 'lab_blog' },
  { id: 'google-research-blog', name: 'Google Research blog', type: 'rss', url: 'https://research.google/blog/rss/', tier: 'lab_blog' },

  gnews('gnews-health', 'Google News: AI in health', 'lead', '-stock -shares -security intitle:AI (patients OR doctors OR NHS OR hospital) (detects OR diagnose OR spots OR predicts OR earlier)'),
  gnews('gnews-climate', 'Google News: AI and climate', 'lead', '-stock -"data centers" -fossil intitle:AI (flood OR wildfire OR drought OR typhoon OR weather OR heatwave) (forecast OR forecasting OR "early warning")'),
  gnews('gnews-accessibility', 'Google News: AI and accessibility', 'lead', '-"blind spot" -"blind spots" -votes intitle:AI (intitle:blind OR intitle:deaf OR intitle:disability OR intitle:wheelchair OR intitle:"sign language" OR intitle:lips)'),
  gnews('gnews-conservation', 'Google News: AI and conservation', 'lead', '-antigen -stock intitle:AI (intitle:wildlife OR intitle:species OR intitle:conservation OR intitle:biodiversity OR intitle:whales OR intitle:birds OR intitle:coral)'),
  gnews('gnews-science', 'Google News: AI in science', 'lead', '-stock -chip intitle:AI (intitle:protein OR intitle:materials OR intitle:galaxies OR intitle:telescope OR intitle:enzyme OR intitle:antibiotics OR intitle:molecules)'),
  gnews('gnews-everyday', 'Google News: AI in everyday life', 'lead', '-scam intitle:AI (intitle:helps OR intitle:helping) (intitle:farmers OR intitle:teachers OR intitle:pupils OR intitle:students OR intitle:elderly OR intitle:carers)'),
  { id: 'good-news-network', name: 'Good News Network', type: 'rss', url: 'https://www.goodnewsnetwork.org/feed/', tier: 'lead', keywordFilter: true },
  { id: 'reasons-to-be-cheerful', name: 'Reasons to be Cheerful', type: 'rss', url: 'https://reasonstobecheerful.world/feed/', tier: 'lead', keywordFilter: true },
]
